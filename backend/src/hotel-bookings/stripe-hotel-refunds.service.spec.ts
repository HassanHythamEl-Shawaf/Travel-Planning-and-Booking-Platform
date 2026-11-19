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
  const model = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec: () => Promise.resolve(doc) }) }),
    }),
  };
  const stripe = opts.stripe ?? {
    refunds: {
      create: jest.fn().mockResolvedValue({ id: 're_1', status: 'succeeded' }),
    },
  };
  const service = new StripeHotelRefundsService(
    { getOrThrow: () => 'sk_test_x' } as never,
    model as never,
    stripe as never,
  );
  return { service, model, stripe: stripe as { refunds: { create: jest.Mock } } };
}

describe('StripeHotelRefundsService (PAY-03)', () => {
  it('refunds the stored PaymentIntent for the computed amount, once', async () => {
    const { service, stripe } = build();
    const issued = await service.issueRefund(request, quote);

    expect(issued).toEqual({ refundId: 're_1', status: 'Refunded' });
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
  });

  it('maps Stripe statuses to Refunded, Pending and Failed', async () => {
    for (const [stripeStatus, expected] of [
      ['succeeded', 'Refunded'],
      ['pending', 'Pending'],
      ['failed', 'Failed'],
      ['canceled', 'Failed'],
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

  it('reports Failed, without calling Stripe, when no PaymentIntent is stored', async () => {
    const { service, stripe } = build({ paymentIntentId: null });
    await expect(service.issueRefund(request, quote)).resolves.toEqual({
      refundId: null,
      status: 'Failed',
    });
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });

  it('reports Failed instead of throwing when Stripe errors', async () => {
    const { service } = build({
      stripe: {
        refunds: { create: jest.fn().mockRejectedValue(new Error('boom')) },
      },
    });
    await expect(service.issueRefund(request, quote)).resolves.toEqual({
      refundId: null,
      status: 'Failed',
    });
  });

  it('does nothing for a zero refund', async () => {
    const { service, model, stripe } = build();
    await expect(
      service.issueRefund(request, { ...quote, refundAmount: 0 }),
    ).resolves.toEqual({ refundId: null, status: null });
    expect(model.findById).not.toHaveBeenCalled();
    expect(stripe.refunds.create).not.toHaveBeenCalled();
  });
});