import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

import { FLIGHT_BOOKING_PAYMENTS } from '../flight-bookings/flight-booking-payments.contract';
import type { FlightBookingPayments } from '../flight-bookings/flight-booking-payments.contract';
import { FlightBookingStatus } from '../flight-bookings/flight-booking-status';

export interface CreatePaymentIntentResult {
  bookingId: string;
  paymentIntentId: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: string;
  expiresAt: Date | null;
}

export interface VerifiedWebhookResult {
  received: true;
  bookingId?: string;
  paymentIntentId?: string;
  eventType: string;
  status: 'confirmed' | 'failed' | 'ignored';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @Inject(FLIGHT_BOOKING_PAYMENTS)
    private readonly bookingPayments: FlightBookingPayments,
    @Optional() @Inject(STRIPE_CLIENT) stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ??
      new Stripe(this.config.getOrThrow<string>('STRIPE_SECRET_KEY'));
  }

  async getPolicySummary(bookingType: 'flight' | 'hotel', bookingId: string) {
    const booking = await this.bookingPayments.getForPayment(bookingId);
    return {
      bookingType,
      bookingId,
      currency: booking.currency,
      totalPrice: booking.totalPrice,
      holdExpiresAt: booking.holdExpiresAt,
      policyVersion: 'v1',
      acceptedAt: null,
    };
  }

  async acceptPolicies(
    bookingType: 'flight' | 'hotel',
    bookingId: string,
    userId: string,
    policyVersion = 'v1',
  ) {
    const booking = await this.bookingPayments.getForPayment(bookingId);
    if (!booking) {
      throw new BadRequestException('Booking not found');
    }

    return {
      bookingType,
      bookingId,
      userId,
      policyVersion,
      acceptedAt: new Date(),
    };
  }

  async createPaymentIntent(
    bookingId: string,
  ): Promise<CreatePaymentIntentResult> {
    const booking = await this.bookingPayments.getForPayment(bookingId);

    if (booking.status !== FlightBookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(
        `Booking ${bookingId} is not pending payment; current status is ${booking.status}`,
      );
    }

    if (booking.holdExpiresAt && booking.holdExpiresAt.getTime() <= Date.now()) {
      await this.bookingPayments.releaseHold(bookingId);
      throw new BadRequestException(
        'The booking hold has expired; create a new booking first.',
      );
    }

    const intent = await this.stripe.paymentIntents.create({
      amount: Math.round(booking.totalPrice * 100),
      currency: booking.currency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      description: `Flight booking ${bookingId}`,
      metadata: {
        bookingId,
        userId: booking.userId,
      },
    });

    return {
      bookingId,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret ?? '',
      amount: booking.totalPrice,
      currency: booking.currency,
      status: intent.status,
      expiresAt: booking.holdExpiresAt,
    };
  }

  async handleWebhook(
    rawBody: string | Buffer,
    signature: string,
  ): Promise<VerifiedWebhookResult> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const bookingId = paymentIntent.metadata?.bookingId;

    switch (event.type) {
      case 'payment_intent.succeeded': {
        if (!bookingId) {
          throw new BadRequestException(
            'Webhook payment intent is missing bookingId metadata',
          );
        }
        await this.bookingPayments.confirmBooking(bookingId);
        return {
          received: true,
          bookingId,
          paymentIntentId: paymentIntent.id,
          eventType: event.type,
          status: 'confirmed',
        };
      }
      case 'payment_intent.payment_failed': {
        if (!bookingId) {
          throw new BadRequestException(
            'Webhook payment intent is missing bookingId metadata',
          );
        }
        this.logger.warn(
          `Payment failed for booking ${bookingId}; payment intent ${paymentIntent.id} remains pending and the hold can still expire naturally.`,
        );
        return {
          received: true,
          bookingId,
          paymentIntentId: paymentIntent.id,
          eventType: event.type,
          status: 'failed',
        };
      }
      default:
        return {
          received: true,
          eventType: event.type,
          status: 'ignored',
        };
    }
  }
}
