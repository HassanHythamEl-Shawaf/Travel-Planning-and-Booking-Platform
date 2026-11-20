import { RefundStatus } from '../payments/payment.schema';
import { StripeHotelRefundsService } from './stripe-hotel-refunds.service';

const request = {
  bookingId: 'b1',
  userId: 'u1',
  bookingReference: 'HTL-ABCD2345',
  hotelId: 'h1',
  totalPrice: 300,
  currency: 'USD',
};
const quote = { refundPercentage: 50, refundAmount: 150, currency: 'USD' };

function build(opts: { paymentIntentId?: string | null; stripe?: unknown } = {}) {
  const doc =
    opts.paymentIntentId === undefined
      ? { paymentIntentId: 'pi_123' }
      : { paymentIntentId: opts.paymentIntentId };
  const bookings = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec: () => Promise.resolve(doc) }) }),
    }),
  };
  const paymentModel = {
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn() }),
  };
  const refundModel = {
    create: jest.fn().mockResolvedValue({ _id: 'refund-record-1' }),
  };
  const stripe = opts.stripe ?? {
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' }),
    },
  };
  const service = new StripeHotelRefundsService(
    { getOrThrow: () => 'sk_test_x' } as never,
    bookings as never,
    paymentModel as never,
    refundModel as never,
    stripe as never,
  );
  return {
    service,
    bookings,
    paymentModel,
    refundModel,
    stripe: stripe as { refunds: { create: jest.Mock } },
  };
}

describe('StripeHotelRefundsService (PAY-03)', () => {
  it('refunds the stored PaymentIntent and saves a user-queryable refund record', async () => {
    const { service, stripe, refundModel } = build();
    const issued = await service.issueRefund(request, quote);

    expect(issued).toEqual({
      refundId: 'refund-record-1',
      status: RefundStatus.REFUNDED,
    });
    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: 'pi_123',
        amount: 15000,
        metadata: {
          bookingId: 'b1',
          bookingType: 'hotel',
          userId: 'u1',
          bookingReference: 'HTL-ABCD2345',
        },
      },
      { idempotencyKey: 'hotel-refund-b1' },
    );
    expect(refundModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingType: 'hotel',
        bookingId: 'b1',
        stripePaymentIntentId: 'pi_123',
        stripeRefundId: 're_1',
        amountMinor: 15000,
        status: RefundStatus.REFUNDED,
      }),
    );
  });

  it('maps Stripe statuses to Refunded, Pending and Failed', async () => {
    for (const [stripeStatus, expected] of [
      ['succeeded', RefundStatus.REFUNDED],
      ['pending', RefundStatus.PENDING],
      ['failed', RefundStatus.FAILED],
      ['canceled', RefundStatus.FAILED],
    ] as const) {
      const { service } = build({
        stripe: {
          refunds: {
            create: jest.fn().mockResolvedValue({ id: 're_9', status: stripeStatus }),
          },
        },
      });
      expect((await service.issueRefund(request, quote)).status).toBe(expected);
    }
  });

  it('updates payment status when a full refund succeeds', async () => {
    const { service, paymentModel } = build();
    await service.issueRefund(request, {
      refundPercentage: 100,
      refundAmount: request.totalPrice,
      currency: request.currency,
    });

    expect(paymentModel.updateOne).toHaveBeenCalledWith(
      { bookingType: 'hotel', bookingId: request.bookingId },
      { $set: { status: 'Refunded' } },
    );
  });

  it('persists Failed when no PaymentIntent is stored', async () => {
    const { service, bookings, stripe, refundModel } = build({
      paymentIntentId: null,
    });
    await expect(service.issueRefund(request, quote)).resolves.toEqual({
      refundId: 'refund-record-1',
      status: RefundStatus.FAILED,
    });
    expect(bookings.findById).toHaveBeenCalledWith('b1');
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(refundModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stripePaymentIntentId: null,
        stripeRefundId: null,
        status: RefundStatus.FAILED,
      }),
    );
  });

  it('persists Failed instead of throwing when Stripe errors', async () => {
    const { service } = build({
      stripe: {
        refunds: { create: jest.fn().mockRejectedValue(new Error('boom')) },
      },
    });
    await expect(service.issueRefund(request, quote)).resolves.toMatchObject({
      refundId: 'refund-record-1',
      status: RefundStatus.FAILED,
    });
  });

  it('does nothing for a zero refund', async () => {
    const { service, bookings, stripe, refundModel } = build();
    await expect(
      service.issueRefund(request, { ...quote, refundAmount: 0 }),
    ).resolves.toEqual({ refundId: null, status: null });
    expect(bookings.findById).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
    expect(refundModel.create).not.toHaveBeenCalled();
  });
});
