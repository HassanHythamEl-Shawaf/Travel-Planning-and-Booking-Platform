import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentStatus } from './payment.schema';
import { PaymentsService } from './payments.service';
import { PolicyAcceptanceService } from './policy-acceptance.service';

describe('PaymentsService', () => {
  const booking = {
    id: '507f1f77bcf86cd799439011',
    userId: '507f191e810c19729de860ea',
    status: 'Pending Payment',
    totalPrice: 125,
    currency: 'USD',
    holdExpiresAt: new Date(Date.now() + 60_000),
    policySnapshot: { cancellationPolicy: 'non-refundable' },
  };
  const flights = {
    getForPayment: jest.fn(),
    confirmBooking: jest.fn(),
    releaseHold: jest.fn(),
    releaseExpiredHolds: jest.fn(),
    completeDepartedBookings: jest.fn(),
  };
  const hotels = {
    getForPayment: jest.fn(),
    confirmBooking: jest.fn(),
    releaseHold: jest.fn(),
    releaseExpiredHolds: jest.fn(),
    completeEndedStays: jest.fn(),
  };
  const policyAcceptance = {
    getAcceptedPolicy: jest.fn(),
    acceptPolicies: jest.fn(),
  };
  const paymentModel = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const refundModel = { create: jest.fn(), findOne: jest.fn() };
  const notifications = { send: jest.fn() };
  const stripe = {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      cancel: jest.fn(),
    },
    refunds: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  };
  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    flights.getForPayment.mockResolvedValue(booking);
    hotels.getForPayment.mockResolvedValue(booking);
    policyAcceptance.getAcceptedPolicy.mockResolvedValue({
      accepted: true,
      acceptedAt: new Date(),
      policySnapshot: booking.policySnapshot,
    });
    paymentModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    paymentModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ...booking,
        bookingType: 'flight',
        bookingId: booking.id,
        amountMinor: 12500,
        stripePaymentIntentId: 'pi_123',
        status: PaymentStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    service = new PaymentsService(
      new ConfigService({
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
      }),
      flights as any,
      hotels as any,
      policyAcceptance as unknown as PolicyAcceptanceService,
      paymentModel as any,
      refundModel as any,
      notifications as any,
      stripe as any,
    );
  });

  it('creates a PaymentIntent only after policies are accepted', async () => {
    stripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_123',
      client_secret: 'secret_123',
      status: 'requires_payment_method',
    });

    await expect(
      service.createPaymentIntent('flight', booking.id, booking.userId),
    ).resolves.toMatchObject({
      bookingId: booking.id,
      bookingType: 'flight',
      paymentIntentId: 'pi_123',
      clientSecret: 'secret_123',
      amount: 125,
      currency: 'USD',
    });
    expect(stripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 12500,
        currency: 'usd',
        metadata: {
          bookingType: 'flight',
          bookingId: booking.id,
          userId: booking.userId,
        },
      }),
      { idempotencyKey: `booking-flight-${booking.id}-0` },
    );

    policyAcceptance.getAcceptedPolicy.mockResolvedValueOnce({
      accepted: false,
      acceptedAt: null,
    });
    await expect(
      service.createPaymentIntent('flight', booking.id, booking.userId),
    ).rejects.toThrow('Current provider policies must be accepted before payment');
  });

  it('confirms the matching booking only after Stripe verifies payment success', async () => {
    const payment = {
      _id: new Types.ObjectId(),
      bookingType: 'flight',
      bookingId: booking.id,
      userId: new Types.ObjectId(booking.userId),
      amountMinor: 12500,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      save: jest.fn(),
    };
    paymentModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(payment),
    });
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 12500,
          amount_received: 12500,
          currency: 'usd',
          metadata: {
            bookingType: 'flight',
            bookingId: booking.id,
            userId: booking.userId,
          },
        },
      },
    });

    await service.handleWebhook('raw-body', 'valid-signature');

    expect(flights.confirmBooking).toHaveBeenCalledWith(booking.id, 'pi_123');
    expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(payment.save).toHaveBeenCalled();
  });

  it('finds refunds whether their owner id is stored as an ObjectId or string', async () => {
    const refundId = '507f1f77bcf86cd799439012';
    const refund = {
      _id: new Types.ObjectId(refundId),
      stripeRefundId: 're_123',
      bookingType: 'hotel',
      bookingId: 'booking-1',
      reason: 'cancellation',
      amountMinor: 12500,
      currency: 'USD',
      status: 'Refunded',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    refundModel.findOne.mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue(refund) }),
    });

    await expect(service.getRefund(refundId, booking.userId)).resolves.toMatchObject({
      id: refundId,
      refundId: 're_123',
      amount: 125,
    });
    expect(refundModel.findOne).toHaveBeenCalledWith({
      userId: { $in: [new Types.ObjectId(booking.userId), booking.userId] },
      $or: [
        { _id: new Types.ObjectId(refundId) },
        { stripeRefundId: refundId },
      ],
    });
  });

  it('rejects a webhook whose paid amount does not match the stored booking', async () => {
    paymentModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        bookingType: 'flight',
        bookingId: booking.id,
        userId: new Types.ObjectId(booking.userId),
        amountMinor: 12500,
        currency: 'USD',
      }),
    });
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 500,
          amount_received: 500,
          currency: 'usd',
          metadata: {
            bookingId: booking.id,
            bookingType: 'flight',
            userId: booking.userId,
          },
        },
      },
    });

    await expect(service.handleWebhook('raw-body', 'valid-signature')).rejects.toThrow(
      'Stripe payment amount or currency does not match the booking',
    );
    expect(flights.confirmBooking).not.toHaveBeenCalled();
  });

  it('creates one refund and one notification for repeated late-payment webhooks', async () => {
    const payment = {
      _id: new Types.ObjectId(),
      bookingType: 'flight',
      bookingId: booking.id,
      userId: new Types.ObjectId(booking.userId),
      amountMinor: 12500,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      save: jest.fn(),
    };
    const refund = {
      _id: new Types.ObjectId(),
      status: 'Refunded',
      amountMinor: 12500,
      currency: 'USD',
    };
    paymentModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(payment),
    });
    refundModel.findOne
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(refund) });
    refundModel.create.mockResolvedValue(refund);
    flights.confirmBooking.mockRejectedValue(
      new ConflictException('booking hold expired'),
    );
    stripe.refunds.create.mockResolvedValue({
      id: 're_late',
      status: 'succeeded',
    });
    stripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          amount: 12500,
          amount_received: 12500,
          currency: 'usd',
          metadata: {
            bookingType: 'flight',
            bookingId: booking.id,
            userId: booking.userId,
          },
        },
      },
    });

    await service.handleWebhook('raw-body', 'valid-signature');
    await service.handleWebhook('raw-body', 'valid-signature');

    expect(stripe.refunds.create).toHaveBeenCalledTimes(1);
    expect(refundModel.create).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledTimes(1);
  });
});
