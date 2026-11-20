import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDeepStrictEqual } from 'node:util';
import Stripe from 'stripe';

import { FLIGHT_BOOKING_PAYMENTS } from '../flight-bookings/flight-booking-payments.contract';
import type { FlightBookingPayments } from '../flight-bookings/flight-booking-payments.contract';
import { HOTEL_BOOKING_PAYMENTS } from '../hotel-bookings/hotel-booking-payments.contract';
import type { HotelBookingPayments } from '../hotel-bookings/hotel-booking-payments.contract';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { Payment, PaymentDocument, PaymentStatus, Refund, RefundDocument, RefundStatus } from './payment.schema';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { createStripeTestClient } from './stripe-test-mode';

export const STRIPE_CLIENT = 'STRIPE_CLIENT';

export type BookingType = 'flight' | 'hotel';

type PayableBooking = {
  id: string;
  userId: string;
  totalPrice: number;
  currency: string;
  status: string;
  holdExpiresAt: Date | null;
  policySnapshot: Record<string, unknown>;
};

export interface CreatePaymentIntentResult {
  id: string;
  bookingId: string;
  bookingType: BookingType;
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
  status:
    | 'confirmed'
    | 'failed'
    | 'refunded'
    | 'refund_pending'
    | 'refund_failed'
    | 'ignored';
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly stripe: Stripe;

  constructor(
    private readonly config: ConfigService,
    @Inject(FLIGHT_BOOKING_PAYMENTS)
    private readonly flights: FlightBookingPayments,
    @Inject(HOTEL_BOOKING_PAYMENTS)
    private readonly hotels: HotelBookingPayments,
    private readonly policies: PolicyAcceptanceService,
    @InjectModel(Payment.name) private readonly payments: Model<PaymentDocument>,
    @InjectModel(Refund.name) private readonly refunds: Model<RefundDocument>,
    private readonly notifications: NotificationsService,
    @Optional() @Inject(STRIPE_CLIENT) stripeClient?: Stripe,
  ) {
    this.stripe =
      stripeClient ??
      createStripeTestClient(
        this.config.getOrThrow<string>('STRIPE_SECRET_KEY'),
      );
  }

  async getPolicySummary(
    bookingType: BookingType,
    bookingId: string,
    userId: string,
  ) {
    const booking = await this.getOwnedBooking(bookingType, bookingId, userId);
    const accepted = await this.policies.getAcceptedPolicy(
      bookingType,
      bookingId,
      userId,
    );
    const policyAccepted =
      accepted.accepted &&
      isDeepStrictEqual(accepted.policySnapshot, booking.policySnapshot);
    return {
      bookingType,
      bookingId,
      amount: booking.totalPrice,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      policyVersion: 'v1',
      policies: booking.policySnapshot,
      accepted: policyAccepted,
      acceptedAt: accepted.acceptedAt,
    };
  }

  async acceptPolicies(
    bookingType: BookingType,
    bookingId: string,
    userId: string,
    policyVersion = 'v1',
  ) {
    const booking = await this.getOwnedBooking(bookingType, bookingId, userId);
    if (booking.status !== 'Pending Payment') {
      throw new ConflictException('Policies can only be accepted for a pending booking');
    }
    this.assertPayable(booking);
    return this.policies.acceptPolicies(
      bookingType,
      bookingId,
      userId,
      policyVersion,
      booking.policySnapshot,
    );
  }

  async createPaymentIntent(
    bookingType: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<CreatePaymentIntentResult> {
    const booking = await this.getOwnedBooking(bookingType, bookingId, userId);
    this.assertPayable(booking);
    await this.assertPoliciesAccepted(
      bookingType,
      bookingId,
      userId,
      booking.policySnapshot,
    );

    const existing = await this.payments
      .findOne({ bookingType, bookingId, userId: new Types.ObjectId(userId) })
      .exec();
    if (existing) {
      const current = await this.stripe.paymentIntents.retrieve(
        existing.stripePaymentIntentId,
      );
      if (current.status !== 'canceled') {
        return this.toIntentResult(existing, current);
      }
    }

    const attempt = existing ? (existing.attempt ?? 0) + 1 : 0;
    const amountMinor = Math.round(booking.totalPrice * 100);
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: booking.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: `${bookingType} booking ${bookingId}`,
        metadata: { bookingType, bookingId, userId },
      },
      { idempotencyKey: `booking-${bookingType}-${bookingId}-${attempt}` },
    );
    let record: PaymentDocument | null;
    try {
      record = await this.payments
        .findOneAndUpdate(
          { bookingType, bookingId, userId: new Types.ObjectId(userId) },
          {
            $set: {
              stripePaymentIntentId: intent.id,
              amountMinor,
              currency: booking.currency,
              status: PaymentStatus.PENDING,
              attempt,
              holdExpiresAt: booking.holdExpiresAt,
            },
            $setOnInsert: {
              bookingType,
              bookingId,
              userId: new Types.ObjectId(userId),
            },
          },
          { upsert: true, new: true, runValidators: true },
        )
        .exec();
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) throw error;
      record = await this.payments
        .findOne({ bookingType, bookingId, userId: new Types.ObjectId(userId) })
        .exec();
      if (!record) throw error;
      const current = await this.stripe.paymentIntents.retrieve(
        record.stripePaymentIntentId,
      );
      return this.toIntentResult(record, current);
    }
    if (!record) throw new Error('Payment record was not saved');
    return this.toIntentResult(record, intent);
  }

  async retryPayment(
    paymentId: string,
    userId: string,
  ): Promise<CreatePaymentIntentResult> {
    const payment = await this.findOwnPayment(paymentId, userId);
    return this.createPaymentIntent(
      payment.bookingType,
      payment.bookingId,
      userId,
    );
  }

  async getPayment(paymentId: string, userId: string) {
    const payment = await this.findOwnPayment(paymentId, userId);
    return {
      id: String(payment._id),
      bookingType: payment.bookingType,
      bookingId: payment.bookingId,
      paymentIntentId: payment.stripePaymentIntentId,
      amount: payment.amountMinor / 100,
      currency: payment.currency,
      status: payment.status,
      holdExpiresAt: payment.holdExpiresAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  async getRefund(refundId: string, userId: string) {
    const ownerIds = [new Types.ObjectId(userId), userId];
    const filter = Types.ObjectId.isValid(refundId)
      ? {
          userId: { $in: ownerIds },
          $or: [
            { _id: new Types.ObjectId(refundId) },
            { stripeRefundId: refundId },
          ],
        }
      : { userId: { $in: ownerIds }, stripeRefundId: refundId };
    const refund = await this.refunds.findOne(filter).lean().exec();
    if (!refund) throw new NotFoundException('Refund not found');
    return {
      id: String(refund._id),
      refundId: refund.stripeRefundId,
      bookingType: refund.bookingType,
      bookingId: refund.bookingId,
      reason: refund.reason,
      amount: refund.amountMinor / 100,
      currency: refund.currency,
      status: refund.status,
      createdAt: refund.createdAt,
      updatedAt: refund.updatedAt,
    };
  }

  async handleWebhook(
    rawBody: string | Buffer,
    signature: string,
  ): Promise<VerifiedWebhookResult> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new ServiceUnavailableException('Stripe webhook verification is not configured');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
      this.logger.warn(
        `Rejected Stripe webhook: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException('Stripe signature or event payload is invalid');
    }
    if (event.type === 'refund.updated') {
      return this.handleRefundWebhook(event);
    }
    const intent = event.data.object as Stripe.PaymentIntent;
    const payment = await this.payments
      .findOne({ stripePaymentIntentId: intent.id })
      .exec();
    if (!payment) {
      this.logger.warn(`Ignoring Stripe event for unknown PaymentIntent ${intent.id}`);
      return { received: true, paymentIntentId: intent.id, eventType: event.type, status: 'ignored' };
    }
    this.assertIntentMatchesRecord(intent, payment);

    if (event.type === 'payment_intent.succeeded') {
      const status = await this.confirmPaidBooking(payment, intent);
      return {
        received: true,
        bookingId: payment.bookingId,
        paymentIntentId: intent.id,
        eventType: event.type,
        status,
      };
    }
    if (event.type === 'payment_intent.payment_failed') {
      const alreadyFailed = payment.status === PaymentStatus.FAILED;
      payment.status = PaymentStatus.FAILED;
      await payment.save();
      if (!alreadyFailed) {
        await this.notifications.send(String(payment.userId), NotificationType.PAYMENT_FAILED, {
          bookingId: payment.bookingId,
          bookingType: payment.bookingType,
          paymentId: String(payment._id),
          amount: payment.amountMinor / 100,
          currency: payment.currency,
        });
      }
      return {
        received: true,
        bookingId: payment.bookingId,
        paymentIntentId: intent.id,
        eventType: event.type,
        status: 'failed',
      };
    }
    if (event.type === 'payment_intent.canceled') {
      payment.status = PaymentStatus.CANCELLED;
      await payment.save();
    }
    return {
      received: true,
      bookingId: payment.bookingId,
      paymentIntentId: intent.id,
      eventType: event.type,
      status: 'ignored',
    };
  }

  /**
   * Called by the one scheduled expiry service before booking holds are
   * released. A PaymentIntent that cannot be cancelled is excluded from the
   * domain expiry sweep and retried on the next run.
   */
  async expirePaymentIntents(now: Date): Promise<string[]> {
    const due = await this.payments
      .find({
        status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
        holdExpiresAt: { $lte: now },
      })
      .exec();
    const protectedBookingKeys: string[] = [];
    for (const payment of due) {
      try {
        let intent = await this.stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId,
        );
        if (intent.status === 'succeeded') {
          await this.confirmPaidBooking(payment, intent);
          continue;
        }
        if (intent.status !== 'canceled') {
          try {
            intent = await this.stripe.paymentIntents.cancel(intent.id);
          } catch (error) {
            intent = await this.stripe.paymentIntents.retrieve(intent.id);
            if (intent.status === 'succeeded') {
              await this.confirmPaidBooking(payment, intent);
              continue;
            }
            throw error;
          }
        }
        payment.status = PaymentStatus.CANCELLED;
        await payment.save();
        await this.gateway(payment.bookingType).releaseHold(payment.bookingId);
      } catch (error) {
        protectedBookingKeys.push(`${payment.bookingType}:${payment.bookingId}`);
        this.logger.error(
          `Could not safely expire ${payment.bookingType} booking ${payment.bookingId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return protectedBookingKeys;
  }

  private async confirmPaidBooking(
    payment: PaymentDocument,
    intent: Stripe.PaymentIntent,
  ): Promise<'confirmed' | 'refunded' | 'refund_pending' | 'refund_failed'> {
    const received = intent.amount_received ?? intent.amount;
    if (
      received !== payment.amountMinor ||
      intent.currency.toUpperCase() !== payment.currency.toUpperCase()
    ) {
      throw new BadRequestException('Stripe payment amount or currency does not match the booking');
    }
    try {
      await this.gateway(payment.bookingType).confirmBooking(
        payment.bookingId,
        intent.id,
      );
      payment.status = PaymentStatus.SUCCEEDED;
      await payment.save();
      return 'confirmed';
    } catch (error) {
      if (!(error instanceof ConflictException)) throw error;
      const { refund, created } = await this.createRefund(payment, intent.id);
      payment.status =
        refund.status === RefundStatus.REFUNDED
          ? PaymentStatus.REFUNDED
          : PaymentStatus.SUCCEEDED;
      await payment.save();
      if (created) {
        await this.notifications.send(
          String(payment.userId),
          refund.status === RefundStatus.FAILED
            ? NotificationType.REFUND_FAILED
            : NotificationType.REFUND_ISSUED,
          {
            bookingId: payment.bookingId,
            bookingType: payment.bookingType,
            paymentId: String(payment._id),
            refundId: String(refund._id),
            amount: refund.amountMinor / 100,
            currency: refund.currency,
          },
        );
      }
      if (refund.status === RefundStatus.REFUNDED) return 'refunded';
      if (refund.status === RefundStatus.PENDING) return 'refund_pending';
      return 'refund_failed';
    }
  }

  private async createRefund(
    payment: PaymentDocument,
    paymentIntentId: string,
  ): Promise<{ refund: RefundDocument; created: boolean }> {
    const existing = await this.refunds
      .findOne({
        bookingType: payment.bookingType,
        bookingId: payment.bookingId,
        reason: 'late_payment',
      })
      .exec();
    if (existing) return { refund: existing, created: false };

    let stripeRefundId: string | null = null;
    let status = RefundStatus.FAILED;
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: payment.amountMinor,
          metadata: {
            bookingType: payment.bookingType,
            bookingId: payment.bookingId,
            reason: 'hold_expired_after_payment',
          },
        },
        { idempotencyKey: `late-payment-refund-${paymentIntentId}` },
      );
      stripeRefundId = refund.id;
      status =
        refund.status === 'succeeded'
          ? RefundStatus.REFUNDED
          : refund.status === 'pending'
            ? RefundStatus.PENDING
            : RefundStatus.FAILED;
    } catch (error) {
      this.logger.error(
        `Could not refund late payment ${paymentIntentId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      const refund = await this.refunds.create({
        bookingType: payment.bookingType,
        bookingId: payment.bookingId,
        reason: 'late_payment',
        userId: payment.userId,
        stripePaymentIntentId: paymentIntentId,
        stripeRefundId,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        status,
      });
      return { refund, created: true };
    } catch (error) {
      if ((error as { code?: number } | null)?.code !== 11000) throw error;
      const refund = await this.refunds
        .findOne({
          bookingType: payment.bookingType,
          bookingId: payment.bookingId,
          reason: 'late_payment',
        })
        .exec();
      if (!refund) throw error;
      return { refund, created: false };
    }
  }

  private async getOwnedBooking(
    bookingType: BookingType,
    bookingId: string,
    userId: string,
  ): Promise<PayableBooking> {
    if (
      !Types.ObjectId.isValid(bookingId) ||
      !Types.ObjectId.isValid(userId)
    ) {
      throw new NotFoundException('Booking not found');
    }
    const booking = await this.gateway(bookingType).getForPayment(bookingId);
    if (booking.userId !== userId) throw new NotFoundException('Booking not found');
    return booking;
  }

  private assertPayable(booking: PayableBooking): void {
    if (booking.status !== 'Pending Payment') {
      throw new ConflictException(`Booking is not pending payment (status: ${booking.status})`);
    }
    if (!booking.holdExpiresAt || booking.holdExpiresAt.getTime() <= Date.now()) {
      throw new ConflictException('The booking hold has expired');
    }
  }

  private async assertPoliciesAccepted(
    bookingType: BookingType,
    bookingId: string,
    userId: string,
    policySnapshot: Record<string, unknown>,
  ): Promise<void> {
    const accepted = await this.policies.getAcceptedPolicy(
      bookingType,
      bookingId,
      userId,
    );
    if (
      !accepted.accepted ||
      !isDeepStrictEqual(accepted.policySnapshot, policySnapshot)
    ) {
      throw new ForbiddenException(
        'Current provider policies must be accepted before payment',
      );
    }
  }

  private async findOwnPayment(
    paymentId: string,
    userId: string,
  ): Promise<PaymentDocument> {
    const criteria: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };
    if (Types.ObjectId.isValid(paymentId)) {
      criteria.$or = [
        { _id: new Types.ObjectId(paymentId) },
        { stripePaymentIntentId: paymentId },
      ];
    } else {
      criteria.stripePaymentIntentId = paymentId;
    }
    const payment = await this.payments.findOne(criteria).exec();
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
  }

  private assertIntentMatchesRecord(
    intent: Stripe.PaymentIntent,
    payment: PaymentDocument,
  ): void {
    const metadata = intent.metadata ?? {};
    if (
      metadata.bookingId !== payment.bookingId ||
      metadata.bookingType !== payment.bookingType ||
      metadata.userId !== String(payment.userId)
    ) {
      throw new BadRequestException('Stripe event metadata does not match the payment record');
    }
  }

  private toIntentResult(
    payment: PaymentDocument,
    intent: Stripe.PaymentIntent,
  ): CreatePaymentIntentResult {
    if (!intent.client_secret) {
      throw new ServiceUnavailableException(
        'Stripe did not return a client secret for the payment',
      );
    }
    return {
      id: String(payment._id),
      bookingId: payment.bookingId,
      bookingType: payment.bookingType,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount: payment.amountMinor / 100,
      currency: payment.currency,
      status: intent.status,
      expiresAt: payment.holdExpiresAt,
    };
  }

  private gateway(type: BookingType): FlightBookingPayments | HotelBookingPayments {
    if (type === 'flight') return this.flights;
    if (type === 'hotel') return this.hotels;
    throw new BadRequestException('Booking type must be flight or hotel');
  }

  private async handleRefundWebhook(
    event: Stripe.Event,
  ): Promise<VerifiedWebhookResult> {
    const stripeRefund = event.data.object as Stripe.Refund;
    const refund = await this.refunds
      .findOne({ stripeRefundId: stripeRefund.id })
      .exec();
    if (!refund) {
      return {
        received: true,
        eventType: event.type,
        status: 'ignored',
      };
    }
    const previousStatus = refund.status;
    refund.status =
      stripeRefund.status === 'succeeded'
        ? RefundStatus.REFUNDED
        : stripeRefund.status === 'pending'
          ? RefundStatus.PENDING
          : RefundStatus.FAILED;
    await refund.save();
    if (
      refund.status === RefundStatus.REFUNDED &&
      refund.stripePaymentIntentId
    ) {
      const payment = await this.payments
        .findOne({ stripePaymentIntentId: refund.stripePaymentIntentId })
        .exec();
      if (payment && refund.amountMinor >= payment.amountMinor) {
        payment.status = PaymentStatus.REFUNDED;
        await payment.save();
      }
    }
    if (previousStatus !== refund.status) {
      await this.notifications.send(
        String(refund.userId),
        refund.status === RefundStatus.REFUNDED
          ? NotificationType.REFUND_ISSUED
          : refund.status === RefundStatus.FAILED
            ? NotificationType.REFUND_FAILED
            : NotificationType.REFUND_ISSUED,
        {
          bookingId: refund.bookingId,
          bookingType: refund.bookingType,
          refundId: String(refund._id),
          amount: refund.amountMinor / 100,
          currency: refund.currency,
        },
      );
    }
    return {
      received: true,
      bookingId: refund.bookingId,
      paymentIntentId: refund.stripePaymentIntentId ?? undefined,
      eventType: event.type,
      status:
        refund.status === RefundStatus.REFUNDED
          ? 'refunded'
          : refund.status === RefundStatus.PENDING
            ? 'refund_pending'
            : refund.status === RefundStatus.FAILED
              ? 'refund_failed'
              : 'ignored',
    };
  }
}
