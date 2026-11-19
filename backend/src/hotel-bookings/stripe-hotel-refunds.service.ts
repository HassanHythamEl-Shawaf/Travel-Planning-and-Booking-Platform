import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Stripe from 'stripe';

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
    @Optional() @Inject(HOTEL_STRIPE_CLIENT) stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ??
      new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
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

    if (!paymentIntentId) {
      this.logger.error(
        `Cannot refund hotel booking ${request.bookingId}: no Stripe PaymentIntent is stored on it`,
      );
      return { refundId: null, status: 'Failed' };
    }

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
        // A retry of the same cancellation can never refund twice.
        { idempotencyKey: `hotel-refund-${request.bookingId}` },
      );

      const status =
        refund.status === 'succeeded'
          ? 'Refunded'
          : refund.status === 'pending'
            ? 'Pending'
            : 'Failed';

      return { refundId: refund.id, status };
    } catch (error) {
      this.logger.error(
        `Stripe refund failed for hotel booking ${request.bookingId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { refundId: null, status: 'Failed' };
    }
  }
}