import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { CancelHotelBookingDto } from './dto/cancel-hotel-booking.dto';
import {
  holdKeyOf,
  stayExcerpt,
} from './hotel-booking-lifecycle.service';
import { HotelBookingStatus } from './hotel-booking-status';
import { HOTEL_REFUNDS } from './hotel-refunds.contract';
import type { HotelRefundQuote, HotelRefunds } from './hotel-refunds.contract';
import { HOTEL_ROOM_READER } from './hotel-room.reader';
import type { HotelRoomReader } from './hotel-room.reader';
import {
  CancellationTerms,
  cancellableBeforeCheckIn,
  DEFAULT_CANCELLATION_TERMS,
  freeCancellationDeadline,
  refundAmountFor,
  refundPercentageFor,
  toCents,
} from './refund-rules';
import { RoomInventoryService } from './room-inventory.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

export interface HotelRefundPreview {
  bookingId: string;
  status: HotelBookingStatus;
  checkIn: string;
  totalPrice: number;
  currency: string;
  refundPercentage: number;
  refundAmount: number;
  /** Cancel before this instant for a full refund. */
  freeCancellationUntil: Date;
  policyDescription: string;
}

export interface HotelCancellationResult {
  bookingId: string;
  status: HotelBookingStatus;
  cancelledAt: Date;
  refundPercentage: number;
  refundAmount: number;
  currency: string;
  /** null if nothing is refunded or the refund could not be created yet. */
  refundId: string | null;
}

@Injectable()
export class HotelBookingCancellationService {
  private readonly logger = new Logger(HotelBookingCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly inventory: RoomInventoryService,
    private readonly notifications: NotificationsService,
    @Inject(HOTEL_REFUNDS) private readonly refunds: HotelRefunds,
    @Inject(HOTEL_ROOM_READER) private readonly reader: HotelRoomReader,
  ) {}

  /** What cancelling would refund today. Changes nothing. */
  async previewRefund(
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<HotelRefundPreview> {
    const booking = await this.findOwn(userId, id);
    const { terms, percentage, amount } = await this.assess(booking, now);
    return {
      bookingId: String(booking._id),
      status: booking.status,
      checkIn: booking.checkInDate.toISOString().slice(0, 10),
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      refundPercentage: percentage,
      refundAmount: amount,
      freeCancellationUntil: freeCancellationDeadline(
        booking.checkInDate,
        terms,
      ),
      policyDescription: terms.description,
    };
  }

  /**
   * HTL-21: cancel my Confirmed reservation as a whole, before the check-in
   * date. One transaction makes it Cancelled and releases every room; the
   * refund request (PAY-03) and the notification follow the commit.
   */
  async cancel(
    userId: string,
    id: string,
    dto: CancelHotelBookingDto,
    now: Date = new Date(),
  ): Promise<HotelCancellationResult> {
    if (dto.confirm !== true) {
      throw new BadRequestException('confirm must be true');
    }
    const booking = await this.findOwn(userId, id);
    const { percentage, amount } = await this.assess(booking, now);

    if (
      dto.expectedRefundAmount !== undefined &&
      toCents(dto.expectedRefundAmount) !== toCents(amount)
    ) {
      throw new ConflictException({
        message: 'The refund changed since it was shown',
        refundAmount: amount,
      });
    }

    const outcome: { booking: HotelBookingDocument | null } = { booking: null };
    await this.connection.transaction(async (session) => {
      outcome.booking = null;
      // GEN-11: Confirmed -> Cancelled is one conditional update, so two
      // cancellations (or a completion) can never both win.
      outcome.booking = await this.bookings
        .findOneAndUpdate(
          {
            _id: booking._id,
            userId: booking.userId,
            status: HotelBookingStatus.CONFIRMED,
            checkInDate: { $gt: now },
          },
          {
            $set: {
              status: HotelBookingStatus.CANCELLED,
              cancelledAt: now,
              refundPercentage: percentage,
              refundAmount: amount,
            },
          },
          { returnDocument: 'after', session },
        )
        .exec();
      if (outcome.booking) {
        await this.inventory.release(session, holdKeyOf(String(booking._id)));
      }
    });

    const cancelled = outcome.booking;
    if (!cancelled) {
      throw new ConflictException('The booking can no longer be cancelled');
    }

    const refund = await this.requestRefund(cancelled, amount, percentage);
    await this.notifyCancelled(cancelled, amount, percentage);
    await this.notifyRefund(cancelled, amount, refund);

    return {
      bookingId: String(cancelled._id),
      status: cancelled.status,
      cancelledAt: now,
      refundPercentage: percentage,
      refundAmount: amount,
      currency: cancelled.currency,
      refundId: refund?.refundId ?? null,
    };
  }

  /** Only the owner's booking; anyone else's is "not found" (ACC-11). */
  private async findOwn(
    userId: string,
    id: string,
  ): Promise<HotelBookingDocument> {
    const booking =
      Types.ObjectId.isValid(id) && Types.ObjectId.isValid(userId)
        ? await this.bookings
            .findOne({
              _id: new Types.ObjectId(id),
              userId: new Types.ObjectId(userId),
            })
            .exec()
        : null;
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  /** Checks the booking can be cancelled and computes the refund. */
  private async assess(booking: HotelBookingDocument, now: Date) {
    if (booking.status !== HotelBookingStatus.CONFIRMED) {
      throw new ConflictException(
        `Only Confirmed reservations can be cancelled (this one is ${booking.status})`,
      );
    }
    if (!cancellableBeforeCheckIn(booking.checkInDate, now)) {
      throw new ConflictException(
        'A reservation can only be cancelled before its check-in date',
      );
    }
    const terms = await this.termsFor(booking);
    const percentage = refundPercentageFor(terms, booking.checkInDate, now);
    return {
      terms,
      percentage,
      amount: refundAmountFor(booking.totalPrice, percentage),
    };
  }

  /** The snapshot taken at hold time, else the hotel's current terms. */
  private async termsFor(
    booking: HotelBookingDocument,
  ): Promise<CancellationTerms> {
    const snapshot = booking.cancellationPolicy;
    if (snapshot) {
      return {
        freeCancellationHours: snapshot.freeCancellationHours,
        refundPercentageAfterDeadline: snapshot.refundPercentageAfterDeadline,
        checkInTime: snapshot.checkInTime,
        checkOutTime:
          snapshot.checkOutTime ?? DEFAULT_CANCELLATION_TERMS.checkOutTime,
        description: snapshot.description,
      };
    }
    return (
      (await this.reader.findCancellationTerms(String(booking.hotelId))) ??
      DEFAULT_CANCELLATION_TERMS
    );
  }

  /** PAY-03. The cancellation is committed, so a failure is logged, not thrown. */
  private async requestRefund(
    booking: HotelBookingDocument,
    amount: number,
    percentage: number,
  ): Promise<{ refundId: string | null; status: string | null } | null> {
    if (amount <= 0) return null;
    const quote: HotelRefundQuote = {
      refundPercentage: percentage,
      refundAmount: amount,
      currency: booking.currency,
    };
    try {
      const issued = await this.refunds.issueRefund(
        {
          bookingId: String(booking._id),
          userId: String(booking.userId),
          bookingReference: booking.bookingReference,
          hotelId: String(booking.hotelId),
          totalPrice: booking.totalPrice,
          currency: booking.currency,
        },
        quote,
      );
      if (issued.status === 'Failed') {
        this.logger.error(
          `Refund of ${amount} ${booking.currency} failed for cancelled hotel booking ${String(booking._id)}`,
        );
      }
      if (issued.refundId) {
        await this.bookings
          .updateOne({ _id: booking._id }, { $set: { refundId: issued.refundId } })
          .exec();
      }
      return issued;
    } catch (error) {
      this.logger.error(
        `Refund request failed for cancelled hotel booking ${String(booking._id)}`,
        error instanceof Error ? error.stack : String(error),
      );
      return { refundId: null, status: 'Failed' };
    }
  }

  private async notifyRefund(
    booking: HotelBookingDocument,
    amount: number,
    refund: { refundId: string | null; status: string | null } | null,
  ): Promise<void> {
    if (!refund?.status) return;
    await this.notifications.send(
      String(booking.userId),
      refund.status === 'Failed'
        ? NotificationType.REFUND_FAILED
        : NotificationType.REFUND_ISSUED,
      {
        bookingId: String(booking._id),
        bookingType: 'hotel',
        bookingReference: booking.bookingReference,
        refundId: refund.refundId,
        amount,
        currency: booking.currency,
      },
    );
  }

  /** GEN-01. Never throws; sent after the cancellation is committed. */
  private async notifyCancelled(
    booking: HotelBookingDocument,
    amount: number,
    percentage: number,
  ) {
    await this.notifications.send(
      String(booking.userId),
      NotificationType.BOOKING_CANCELLED,
      {
        bookingType: 'hotel',
        bookingId: String(booking._id),
        bookingReference: booking.bookingReference,
        providerType: 'hotel',
        providerId: String(booking.hotelId),
        hotelId: String(booking.hotelId),
        providerName: booking.hotelName,
        amount,
        currency: booking.currency,
        excerpt: `${stayExcerpt(booking)}; refund ${amount.toFixed(2)} ${booking.currency} (${percentage}%)`,
      },
    );
  }
}