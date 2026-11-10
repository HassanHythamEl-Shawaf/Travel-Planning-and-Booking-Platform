import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { calculateRefundPercentage } from '../airlines/cancellation-policy';
import { Airline } from '../airlines/schemas/airline.schema';
import { CancellationSource } from './flight-booking.constants';
import type {
  FlightRefundQuote,
  FlightRefundRequest,
  FlightRefunds,
  IssuedFlightRefund,
} from './flight-refunds.contract';
import { roundMoney } from './passenger-rules';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` until departure; 0 on the day itself. */
export function daysBeforeDeparture(departureAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((departureAt.getTime() - now.getTime()) / DAY_MS),
  );
}

/**
 * Default FLIGHT_REFUNDS binding until Person 7's refund service exists.
 * The amount follows FLT-09 (Person 3's calculateRefundPercentage on the
 * outbound airline's tiers) or 100% for airline cancellations (FLT-06).
 * issueRefund does NOT move money: it logs a warning so the gap is visible.
 */
@Injectable()
export class AirlineTierRefunds implements FlightRefunds {
  private readonly logger = new Logger(AirlineTierRefunds.name);

  constructor(
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
  ) {}

  async previewRefund(
    request: FlightRefundRequest,
    now = new Date(),
  ): Promise<FlightRefundQuote> {
    const days = daysBeforeDeparture(request.departureAt, now);
    let percentage = 100;
    if (request.source === CancellationSource.USER) {
      const airline = await this.airlineModel
        .findById(request.airlineId, { cancellationPolicy: 1 })
        .lean()
        .exec();
      percentage = calculateRefundPercentage(
        airline?.cancellationPolicy ?? [],
        days,
      );
    }
    return {
      daysBeforeDeparture: days,
      refundPercentage: percentage,
      refundAmount: roundMoney((request.totalPrice * percentage) / 100),
      currency: request.currency,
    };
  }

  async issueRefund(
    request: FlightRefundRequest,
    quote: FlightRefundQuote,
  ): Promise<IssuedFlightRefund> {
    this.logger.warn(
      `No refund service is bound to FLIGHT_REFUNDS (Person 7): refund of ${quote.refundAmount} ${quote.currency} for flight booking ${request.bookingId} was not issued`,
    );
    return { refundId: null, status: null };
  }
}
