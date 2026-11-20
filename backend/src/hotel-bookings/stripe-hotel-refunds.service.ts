import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';

import {
  Payment,
  PaymentDocument,
  PaymentStatus,
  Refund,
  RefundStatus,
} from '../payments/payment.schema';
import { createStripeTestClient } from '../payments/stripe-test-mode';
import type {
  HotelRefundQuote,
  HotelRefundRequest,
  HotelRefunds,
  IssuedHotelRefund,
} from './hotel-refunds.contract';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

/** Lets a test (or another module) supply a Stripe client. */
export const HOTEL_STRIPE_CLIENT = 'HOTEL_STRIPE_CLIENT';

/**
 * PAY-03 for hotels: refunds the Stripe payment that confirmed the booking.
 * The PaymentIntent id was stored on the booking at confirmation. Stripe
 * requires a payment_intent (or charge) to refund, so a booking without one
 * cannot be refunded here and is reported as Failed for follow-up.
 */
@Injectable()
export class StripeHotelRefundsService implements HotelRefunds {
  private readonly logger = new Logger(StripeHotelRefundsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name)
    private readonly refundModel: Model<Refund>,
    @Optional() @Inject(HOTEL_STRIPE_CLIENT) stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ??
      createStripeTestClient(
        this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      );
  }

  async issueRefund(
    request: HotelRefundRequest,
    quote: HotelRefundQuote,
  ): Promise<IssuedHotelRefund> {
    if (quote.refundAmount <= 0) {
      return { refundId: null, status: null };
    }

    const stored = (await this.bookings
      .findById(request.bookingId)
      .select('paymentIntentId')
      .lean()
      .exec()) as { paymentIntentId?: string | null } | null;
    const paymentIntentId = stored?.paymentIntentId ?? null;

    let stripeRefundId: string | null = null;
    let status = RefundStatus.FAILED;
    if (!paymentIntentId) {
      this.logger.error(
        `Cannot refund hotel booking ${request.bookingId}: no Stripe PaymentIntent is stored on it`,
      );
    } else {
      try {
        const refund = await this.stripe.refunds.create(
          {
            payment_intent: paymentIntentId,
            amount: Math.round(quote.refundAmount * 100),
            metadata: {
              bookingId: request.bookingId,
              bookingType: 'hotel',
              userId: request.userId,
              bookingReference: request.bookingReference ?? '',
            },
          },
          { idempotencyKey: `hotel-refund-${request.bookingId}` },
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
              { bookingType: 'hotel', bookingId: request.bookingId },
              { $set: { status: PaymentStatus.REFUNDED } },
            )
            .exec();
        }
      } catch (error) {
        this.logger.error(
          `Stripe refund failed for hotel booking ${request.bookingId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const record = await this.refundModel.create({
      bookingType: 'hotel',
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