import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { FLIGHT_INVENTORY } from '../airlines/flight-inventory';
import type { FlightInventoryReader } from '../airlines/flight-inventory';
import { Airline } from '../airlines/schemas/airline.schema';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CancelFlightBookingDto,
  FlightCancellationResultDto,
  FlightRefundPreviewDto,
} from './dto/cancel-flight-booking.dto';
import { CancellationSource } from './flight-booking.constants';
import { FlightBookingStatus } from './flight-booking-status';
import { toDetails } from './flight-bookings.service';
import type { LeanBooking } from './flight-bookings.service';
import { FLIGHT_REFUNDS } from './flight-refunds.contract';
import type {
  FlightRefundQuote,
  FlightRefundRequest,
  FlightRefunds,
  IssuedFlightRefund,
} from './flight-refunds.contract';
import { FlightBooking } from './schemas/flight-booking.schema';

/**
 * FLT-26: a user cancels their own Confirmed booking before departure,
 * after seeing the refund. A round trip is cancelled as a whole using the
 * outbound segment's tier (FLT-12).
 */
@Injectable()
export class FlightBookingCancellationService {
  private readonly logger = new Logger(FlightBookingCancellationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @Inject(FLIGHT_INVENTORY)
    private readonly inventory: FlightInventoryReader,
    @Inject(FLIGHT_REFUNDS)
    private readonly refunds: FlightRefunds,
    private readonly notifications: NotificationsService,
  ) {}

  async previewRefund(
    userId: string,
    bookingId: string,
    now = new Date(),
  ): Promise<FlightRefundPreviewDto> {
    const booking = await this.findOwned(userId, bookingId);
    assertCancellable(booking, now);
    const quote = await this.refunds.previewRefund(
      refundRequest(booking, CancellationSource.USER),
      now,
    );
    return {
      bookingId,
      bookingReference: booking.bookingReference,
      totalPrice: booking.totalPrice,
      currency: booking.currency,
      daysBeforeDeparture: quote.daysBeforeDeparture,
      refundPercentage: quote.refundPercentage,
      refundAmount: quote.refundAmount,
    };
  }

  async cancel(
    userId: string,
    bookingId: string,
    dto: CancelFlightBookingDto,
    now = new Date(),
  ): Promise<FlightCancellationResultDto> {
    const booking = await this.findOwned(userId, bookingId);
    assertCancellable(booking, now);
    const request = refundRequest(booking, CancellationSource.USER);
    const quote = await this.refunds.previewRefund(request, now);
    if (
      dto.expectedRefundAmount !== undefined &&
      dto.expectedRefundAmount !== quote.refundAmount
    ) {
      throw new ConflictException(
        `The refund is now ${quote.refundAmount} ${quote.currency}, not ${dto.expectedRefundAmount}; please review it again`,
      );
    }

    // One conditional update decides the race with a second cancel request,
    // departure or the expiry job: only a still-Confirmed, not-yet-departed
    // booking of this user is cancelled, and only once.
    const cancelled = await this.bookingModel
      .findOneAndUpdate(
        {
          _id: booking._id,
          userId: booking.userId,
          status: FlightBookingStatus.CONFIRMED,
          departureAt: { $gt: now },
        },
        {
          $set: {
            status: FlightBookingStatus.CANCELLED,
            cancelledAt: now,
            cancellationSource: CancellationSource.USER,
            refundPercentage: quote.refundPercentage,
            refundAmount: quote.refundAmount,
          },
        },
        { returnDocument: 'after' },
      )
      .lean<LeanBooking>()
      .exec();
    if (!cancelled) {
      assertCancellable(await this.findOwned(userId, bookingId), now);
      throw new ConflictException(
        'The booking could not be cancelled; please retry',
      );
    }

    await Promise.all(
      cancelled.segments
        .filter((segment) => segment.holdId)
        .map((segment) =>
          this.inventory.releaseConfirmedSeats(segment.holdId!),
        ),
    );

    const issued = await this.issueRefund(request, quote);
    const final = issued.refundId
      ? await this.bookingModel
          .findByIdAndUpdate(
            cancelled._id,
            { $set: { refundId: issued.refundId } },
            { returnDocument: 'after' },
          )
          .lean<LeanBooking>()
          .exec()
      : cancelled;

    await this.notifications.send(userId, NotificationType.BOOKING_CANCELLED, {
      bookingId,
      bookingType: 'flight',
      bookingReference: cancelled.bookingReference,
      providerName: await this.airlineName(cancelled.airlineId),
    });

    return {
      booking: toDetails(final ?? cancelled),
      refund: {
        refundPercentage: quote.refundPercentage,
        refundAmount: quote.refundAmount,
        currency: quote.currency,
        refundId: issued.refundId,
        status: issued.status,
      },
    };
  }

  /** PAY-03: only a positive amount is refunded; a refund failure never undoes the cancellation. */
  private async issueRefund(
    request: FlightRefundRequest,
    quote: FlightRefundQuote,
  ): Promise<IssuedFlightRefund> {
    if (quote.refundAmount <= 0) return { refundId: null, status: null };
    try {
      return await this.refunds.issueRefund(request, quote);
    } catch (error) {
      this.logger.error(
        `Refund for cancelled flight booking ${request.bookingId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { refundId: null, status: 'Failed' };
    }
  }

  /** Someone else's booking is reported as not found (ACC-11). */
  private async findOwned(
    userId: string,
    bookingId: string,
  ): Promise<LeanBooking> {
    const booking = Types.ObjectId.isValid(bookingId)
      ? await this.bookingModel
          .findOne({
            _id: new Types.ObjectId(bookingId),
            userId: new Types.ObjectId(userId),
          })
          .lean<LeanBooking>()
          .exec()
      : null;
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

/** FLT-26: only Confirmed bookings, and never after the outbound departure. */
function assertCancellable(booking: LeanBooking, now: Date): void {
  if (booking.status !== FlightBookingStatus.CONFIRMED) {
    throw new ConflictException(
      `Only Confirmed bookings can be cancelled; this booking is ${booking.status}`,
    );
  }
  if (booking.departureAt.getTime() <= now.getTime()) {
    throw new ConflictException(
      'A booking cannot be cancelled after departure',
    );
  }
}

export function refundRequest(
  booking: LeanBooking,
  source: CancellationSource,
): FlightRefundRequest {
  return {
    bookingId: booking._id.toString(),
    userId: booking.userId.toString(),
    bookingReference: booking.bookingReference,
    airlineId: booking.airlineId.toString(),
    departureAt: booking.departureAt,
    totalPrice: booking.totalPrice,
    currency: booking.currency,
    source,
  };
}
