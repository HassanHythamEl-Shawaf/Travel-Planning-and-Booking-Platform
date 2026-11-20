/** HTL-18: how long selected rooms stay held while the guest pays. */
export const HOLD_MINUTES = 10;

export function holdExpiryFor(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60 * 1000);
}