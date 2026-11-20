import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { generateBookingReference } from './booking-reference';
import { HotelBookingStatus } from './hotel-booking-status';
import { HOTEL_ROOM_READER } from './hotel-room.reader';
import type { HotelRoomReader } from './hotel-room.reader';
import type {
  ConfirmedHotelBooking,
  HotelBookingPaymentInfo,
  HotelBookingPayments,
} from './hotel-booking-payments.contract';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

const MAX_REFERENCE_ATTEMPTS = 5;

/**
 * Key under which a booking's room dates are held in the hotels module
 * (HotelsService.reserveDates / confirmDates / releaseDates take a
 * "bookingReference"). The user-facing reference does not exist until
 * confirmation, so HTL-18 must hold the dates under this key.
 */
export function holdKeyOf(bookingId: string): string {
  return bookingId;
}

const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/** Stay details as one line, e.g. "2026-12-20 to 2026-12-23, 3 nights, 2 rooms". */
export function stayExcerpt(booking: HotelBookingDocument): string {
  return [
    `${dateOnly(booking.checkInDate)} to ${dateOnly(booking.checkOutDate)}`,
    plural(booking.nights, 'night'),
    plural(booking.rooms.length, 'room'),
  ].join(', ');
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

@Injectable()
export class HotelBookingLifecycleService implements HotelBookingPayments {
  private readonly logger = new Logger(HotelBookingLifecycleService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @Inject(HOTEL_ROOM_READER) private readonly rooms: HotelRoomReader,
    private readonly notifications: NotificationsService,
  ) {}

  async getForPayment(id: string): Promise<HotelBookingPaymentInfo> {
    const booking = await this.find(id);
    return {
      id: String(booking._id),
      ownerId: String(booking.userId),
      amount: booking.totalPrice,
      currency: booking.currency,
      status: booking.status,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  /** HTL-17. One conditional update, so confirm and expiry can never both win. */
  async confirmBooking(
    id: string,
    now: Date = new Date(),
  ): Promise<ConfirmedHotelBooking> {
    const confirmed = await this.transitionToConfirmed(id, now);
    if (!confirmed) return this.settleWithoutTransition(id);

    await this.confirmInventory(confirmed);
    await this.notifyConfirmed(confirmed);
    return this.toConfirmed(confirmed);
  }

  /** Pending Payment (hold still running) -> Confirmed, all rooms at once. */
  private async transitionToConfirmed(
    id: string,
    now: Date,
  ): Promise<HotelBookingDocument | null> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Hotel booking not found');
    }
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
      try {
        return await this.bookings
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(id),
              status: HotelBookingStatus.PENDING_PAYMENT,
              holdExpiresAt: { $gt: now },
            },
            {
              $set: {
                status: HotelBookingStatus.CONFIRMED,
                bookingReference: generateBookingReference(),
                confirmedAt: now,
                holdExpiresAt: null,
              },
            },
            { returnDocument: 'after' },
          )
          .exec();
      } catch (error) {
        // The whole update was rejected, so retrying with a new reference
        // is safe. Anything else is a real failure.
        if (!isDuplicateKey(error)) throw error;
      }
    }
    throw new ServiceUnavailableException(
      'Could not generate a unique booking reference',
    );
  }

  /** The update matched nothing: repeat call, expired hold, or wrong state. */
  private async settleWithoutTransition(
    id: string,
  ): Promise<ConfirmedHotelBooking> {
    const booking = await this.find(id);
    if (booking.status === HotelBookingStatus.CONFIRMED) {
      // Repeat is safe: retry the inventory step, but notify only once.
      await this.confirmInventory(booking);
      return this.toConfirmed(booking);
    }
    if (booking.status === HotelBookingStatus.PENDING_PAYMENT) {
      throw new ConflictException('The payment arrived after the hold expired');
    }
    throw new ConflictException(
      `A ${booking.status} booking cannot be confirmed`,
    );
  }

  /**
   * Held -> booked for every room of the reservation. The booking is already
   * Confirmed and paid, so a failure here is logged, not thrown: the dates
   * stay "held", which still blocks double booking, and a repeat call retries.
   */
  private async confirmInventory(booking: HotelBookingDocument) {
    try {
      await this.rooms.confirmRoomDates(holdKeyOf(String(booking._id)));
    } catch (error) {
      this.logger.error(
        `Could not mark room dates booked for hotel booking ${String(booking._id)}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * GEN-01. Never throws; sent after the confirmation is committed. Only keys
   * in NOTIFICATION_PAYLOAD_KEYS are stored. It has no stay-date keys, so the
   * dates, nights and room count travel in `excerpt`.
   */
  private async notifyConfirmed(booking: HotelBookingDocument) {
    await this.notifications.send(
      String(booking.userId),
      NotificationType.BOOKING_CONFIRMED,
      {
        bookingType: 'hotel',
        bookingId: String(booking._id),
        bookingReference: booking.bookingReference,
        providerType: 'hotel',
        providerId: String(booking.hotelId),
        hotelId: String(booking.hotelId),
        providerName: booking.hotelName,
        amount: booking.totalPrice,
        currency: booking.currency,
        excerpt: stayExcerpt(booking),
      },
    );
  }

  private async find(id: string): Promise<HotelBookingDocument> {
    const booking = Types.ObjectId.isValid(id)
      ? await this.bookings.findById(id).exec()
      : null;
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  private toConfirmed(booking: HotelBookingDocument): ConfirmedHotelBooking {
    return {
      id: String(booking._id),
      bookingReference: booking.bookingReference as string,
      status: booking.status,
      confirmedAt: booking.confirmedAt as Date,
    };
  }
}