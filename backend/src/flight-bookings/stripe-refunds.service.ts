import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';

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

function daysBeforeDeparture(departureAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((departureAt.getTime() - now.getTime()) / DAY_MS),
  );
}

@Injectable()
export class StripeRefundsService implements FlightRefunds {
  private readonly logger = new Logger(StripeRefundsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
  ) {
    this.stripe = new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }

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
    if (quote.refundAmount <= 0) {
      return { refundId: null, status: null };
    }

    try {
      const refund = await this.stripe.refunds.create({
        amount: Math.round(quote.refundAmount * 100),
        currency: quote.currency.toLowerCase(),
        metadata: {
          bookingId: request.bookingId,
          userId: request.userId,
          bookingReference: request.bookingReference ?? '',
          source: request.source,
        },
      });

      const status =
        refund.status === 'succeeded'
          ? 'Refunded'
          : refund.status === 'pending'
            ? 'Pending'
            : 'Failed';

      return { refundId: refund.id, status };
    } catch (error) {
      this.logger.error(
        `Stripe refund failed for booking ${request.bookingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { refundId: null, status: 'Failed' };
    }
  }
}
