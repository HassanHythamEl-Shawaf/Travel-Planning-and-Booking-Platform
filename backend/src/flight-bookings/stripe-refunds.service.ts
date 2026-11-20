import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';

import { calculateRefundPercentage } from '../airlines/cancellation-policy';
import { Airline } from '../airlines/schemas/airline.schema';
import {
  Payment,
  PaymentDocument,
  PaymentStatus,
  Refund,
  RefundStatus,
} from '../payments/payment.schema';
import { createStripeTestClient } from '../payments/stripe-test-mode';
import { CancellationSource } from './flight-booking.constants';
import type {
  FlightRefundQuote,
  FlightRefundRequest,
  FlightRefunds,
  IssuedFlightRefund,
} from './flight-refunds.contract';
import { roundMoney } from './passenger-rules';
import { FlightBooking } from './schemas/flight-booking.schema';

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
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name)
    private readonly refundModel: Model<Refund>,
  ) {
    this.stripe = createStripeTestClient(
      this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
    );
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

    const booking = await this.bookingModel
      .findById(request.bookingId)
      .select('paymentIntentId')
      .lean()
      .exec();
    const paymentIntentId = booking?.paymentIntentId ?? null;
    let stripeRefundId: string | null = null;
    let status = RefundStatus.FAILED;

    if (paymentIntentId) {
      try {
        const refund = await this.stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: Math.round(quote.refundAmount * 100),
            currency: quote.currency.toLowerCase(),
            metadata: {
              bookingId: request.bookingId,
              bookingType: 'flight',
              userId: request.userId,
              bookingReference: request.bookingReference ?? '',
              source: request.source,
            },
          },
          { idempotencyKey: `flight-refund-${request.bookingId}` },
        );
        stripeRefundId = refund.id;
        status =
          refund.status === 'succeeded'
            ? RefundStatus.REFUNDED
            : refund.status === 'pending'
              ? RefundStatus.PENDING
              : RefundStatus.FAILED;
        if (
          status === RefundStatus.REFUNDED &&
          quote.refundAmount >= request.totalPrice
        ) {
          await this.paymentModel
            .updateOne(
              { bookingType: 'flight', bookingId: request.bookingId },
              { $set: { status: PaymentStatus.REFUNDED } },
            )
            .exec();
        }
      } catch (error) {
        this.logger.error(
          `Stripe refund failed for booking ${request.bookingId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      this.logger.error(
        `Cannot refund flight booking ${request.bookingId}: no Stripe PaymentIntent is stored on it`,
      );
    }

    const record = await this.refundModel.create({
      bookingType: 'flight',
      bookingId: request.bookingId,
      userId: request.userId,
      stripePaymentIntentId: paymentIntentId,
      stripeRefundId,
      amountMinor: Math.round(quote.refundAmount * 100),
      currency: quote.currency,
      status,
    });
    return { refundId: String(record._id), status };
  }
}
