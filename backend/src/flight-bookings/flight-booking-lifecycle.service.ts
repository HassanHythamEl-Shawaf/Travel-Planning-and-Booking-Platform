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

import { FLIGHT_INVENTORY } from '../airlines/flight-inventory';
import type { FlightInventoryReader } from '../airlines/flight-inventory';
import { Airline } from '../airlines/schemas/airline.schema';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { generateBookingReference } from './booking-reference';
import type {
  ConfirmedFlightBooking,
  FlightBookingPayments,
  PayableFlightBooking,
} from './flight-booking-payments.contract';
import { FlightBookingStatus } from './flight-booking-status';
import { FlightBooking } from './schemas/flight-booking.schema';

type LeanBooking = FlightBooking & { _id: Types.ObjectId };

/** Attempts at a fresh reference if one collides with the unique index. */
const MAX_REFERENCE_ATTEMPTS = 5;

/**
 * Pending Payment -> Confirmed / Expired, and Confirmed -> Completed
 * (GEN-11, FLT-22, FLT-23). Every transition first flips the booking's
 * status with one conditional update, so when confirmation and expiry race
 * exactly one of them wins, and only the winner touches inventory.
 */
@Injectable()
export class FlightBookingLifecycleService implements FlightBookingPayments {
  private readonly logger = new Logger(FlightBookingLifecycleService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @Inject(FLIGHT_INVENTORY)
    private readonly inventory: FlightInventoryReader,
    private readonly notifications: NotificationsService,
  ) {}

  async getForPayment(bookingId: string): Promise<PayableFlightBooking> {
    const booking = await this.findOrThrow(bookingId);
    return {
      id: booking._id.toString(),
      userId: booking.userId.toString(),
      status: booking.status,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
    };
  }

  async confirmBooking(bookingId: string): Promise<ConfirmedFlightBooking> {
    const id = toObjectId(bookingId);
    const confirmedAt = new Date();
    const { before, reference } = await this.claimForConfirmation(
      id,
      confirmedAt,
    );

    if (!before) {
      const current = await this.findOrThrow(bookingId);
      if (current.status === FlightBookingStatus.CONFIRMED) {
        return {
          id: bookingId,
          bookingReference: current.bookingReference!,
          newlyConfirmed: false,
        };
      }
      throw new ConflictException(
        current.status === FlightBookingStatus.PENDING_PAYMENT
          ? 'The seat hold has expired; the booking cannot be confirmed'
          : `A ${current.status} booking cannot be confirmed`,
      );
    }

    let converted = 0;
    try {
      for (const segment of before.segments) {
        await this.inventory.confirmInventory(segment.holdId!);
        converted++;
      }
    } catch (error) {
      if (converted > 0) {
        this.logger.error(
          `Booking ${bookingId}: ${converted} of ${before.segments.length} segment(s) were converted to booked seats before inventory confirmation failed`,
        );
      }
      // Undo the claim so the booking stays Pending Payment and can expire.
      await this.bookingModel
        .updateOne(
          {
            _id: id,
            status: FlightBookingStatus.CONFIRMED,
            bookingReference: reference,
          },
          {
            $set: {
              status: FlightBookingStatus.PENDING_PAYMENT,
              bookingReference: null,
              confirmedAt: null,
              holdExpiresAt: before.holdExpiresAt,
            },
          },
        )
        .exec();
      throw error;
    }

    await this.notifications.send(
      before.userId.toString(),
      NotificationType.BOOKING_CONFIRMED,
      {
        bookingId,
        bookingType: 'flight',
        bookingReference: reference,
        providerName: await this.airlineName(before.airlineId),
      },
    );
    return { id: bookingId, bookingReference: reference, newlyConfirmed: true };
  }

  async releaseHold(bookingId: string, now = new Date()): Promise<boolean> {
    const id = toObjectId(bookingId);
    const before = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: id,
          status: FlightBookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: now },
        },
        {
          $set: {
            status: FlightBookingStatus.EXPIRED,
            expiredAt: now,
            holdExpiresAt: null,
          },
        },
        { returnDocument: 'before' },
      )
      .lean<LeanBooking>()
      .exec();

    if (!before) {
      const current = await this.findOrThrow(bookingId);
      if (current.status === FlightBookingStatus.PENDING_PAYMENT) {
        throw new ConflictException('The seat hold has not expired yet');
      }
      return false;
    }

    await Promise.all(
      before.segments
        .filter((segment) => segment.holdId)
        .map((segment) => this.inventory.releaseHold(segment.holdId!)),
    );
    await this.notifications.send(
      before.userId.toString(),
      NotificationType.BOOKING_EXPIRED,
      {
        bookingId,
        bookingType: 'flight',
        providerName: await this.airlineName(before.airlineId),
      },
    );
    return true;
  }

  async releaseExpiredHolds(now = new Date()): Promise<number> {
    const expired = await this.bookingModel
      .find(
        {
          status: FlightBookingStatus.PENDING_PAYMENT,
          holdExpiresAt: { $lte: now },
        },
        { _id: 1 },
      )
      .lean()
      .exec();

    let released = 0;
    for (const { _id } of expired) {
      try {
        if (await this.releaseHold(_id.toString(), now)) released++;
      } catch (error) {
        this.logger.error(
          `Could not release flight booking ${_id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return released;
  }

  async completeDepartedBookings(now = new Date()): Promise<number> {
    const result = await this.bookingModel
      .updateMany(
        {
          status: FlightBookingStatus.CONFIRMED,
          // No segment departs after `now`: the whole trip has departed.
          'segments.departureAt': { $not: { $gt: now } },
        },
        { $set: { status: FlightBookingStatus.COMPLETED, completedAt: now } },
      )
      .exec();
    return result.modifiedCount;
  }

  /** Overridable in tests to force reference collisions. */
  protected newReference(): string {
    return generateBookingReference();
  }

  /**
   * Atomically moves an unexpired Pending Payment booking to Confirmed with a
   * new reference. Returns the booking as it was before, or null if it was
   * not in that state. Retries when the reference is already taken.
   */
  private async claimForConfirmation(
    id: Types.ObjectId,
    confirmedAt: Date,
  ): Promise<{ before: LeanBooking | null; reference: string }> {
    for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
      const reference = this.newReference();
      try {
        const before = await this.bookingModel
          .findOneAndUpdate(
            {
              _id: id,
              status: FlightBookingStatus.PENDING_PAYMENT,
              holdExpiresAt: { $gt: confirmedAt },
            },
            {
              $set: {
                status: FlightBookingStatus.CONFIRMED,
                bookingReference: reference,
                confirmedAt,
                holdExpiresAt: null,
              },
            },
            { returnDocument: 'before' },
          )
          .lean<LeanBooking>()
          .exec();
        return { before, reference };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    throw new ServiceUnavailableException(
      'Could not issue a unique booking reference; please retry',
    );
  }

  private async findOrThrow(bookingId: string): Promise<LeanBooking> {
    const booking = await this.bookingModel
      .findById(toObjectId(bookingId))
      .lean<LeanBooking>()
      .exec();
    if (!booking) throw new NotFoundException('Flight booking not found');
    return booking;
  }

  private async airlineName(
    airlineId: Types.ObjectId,
  ): Promise<string | undefined> {
    const airline = await this.airlineModel
      .findById(airlineId, { name: 1 })
      .lean()
      .exec();
    return airline?.name;
  }
}

function toObjectId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) {
    throw new NotFoundException('Flight booking not found');
  }
  return new Types.ObjectId(id);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}
