import { createStripeTestClient } from './stripe-test-mode';

describe('createStripeTestClient', () => {
  it('rejects live-mode secret keys', () => {
    expect(() => createStripeTestClient('sk_live_not-for-use')).toThrow(
      'Stripe must be configured with a test-mode secret key',
    );
  });
});
