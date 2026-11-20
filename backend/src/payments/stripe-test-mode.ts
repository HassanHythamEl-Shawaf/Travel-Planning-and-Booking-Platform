import Stripe from 'stripe';

export function createStripeTestClient(secretKey: string): Stripe {
  if (!secretKey.startsWith('sk_test_')) {
    throw new Error('Stripe must be configured with a test-mode secret key');
  }
  return new Stripe(secretKey);
}
