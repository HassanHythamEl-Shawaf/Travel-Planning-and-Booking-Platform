import { ConfigService } from '@nestjs/config';

import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  const mockBookingPayments = {
    getForPayment: jest.fn(),
    confirmBooking: jest.fn(),
    releaseHold: jest.fn(),
    releaseExpiredHolds: jest.fn(),
    completeDepartedBookings: jest.fn(),
  };

  const mockStripe = {
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  };

  let service: PaymentsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentsService(
      new ConfigService({
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
      }),
      mockBookingPayments as any,
      mockStripe as any,
    );
  });

  it('creates a payment intent for a pending booking', async () => {
    mockBookingPayments.getForPayment.mockResolvedValue({
      id: 'booking-1',
      userId: 'user-1',
      status: 'Pending Payment',
      totalPrice: 125,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 60_000),
    });
    mockStripe.paymentIntents.create.mockResolvedValue({
      id: 'pi_123',
      client_secret: 'secret_123',
      status: 'requires_payment_method',
    });

    await expect(service.createPaymentIntent('booking-1')).resolves.toMatchObject({
      bookingId: 'booking-1',
      paymentIntentId: 'pi_123',
      clientSecret: 'secret_123',
      amount: 125,
      currency: 'USD',
    });
    expect(mockBookingPayments.getForPayment).toHaveBeenCalledWith('booking-1');
    expect(mockStripe.paymentIntents.create).toHaveBeenCalled();
  });

  it('confirms the booking only after a verified successful webhook', async () => {
    mockStripe.webhooks.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          metadata: { bookingId: 'booking-1' },
        },
      },
    });

    await service.handleWebhook('raw-body', 'valid-signature');

    expect(mockBookingPayments.confirmBooking).toHaveBeenCalledWith('booking-1');
  });
});
