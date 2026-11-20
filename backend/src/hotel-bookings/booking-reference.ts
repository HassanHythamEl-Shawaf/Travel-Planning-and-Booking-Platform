import { randomInt } from 'crypto';

/** No 0/O/1/I, so a reference read aloud or copied by hand is unambiguous. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 8;

/**
 * HTL-17: e.g. HTL-7KQ2M9XA. Uniqueness is guaranteed by the partial unique
 * index on bookingReference; the lifecycle service retries on a collision.
 */
export function generateBookingReference(
  pick: (exclusiveMax: number) => number = (max) => randomInt(max),
): string {
  let code = '';
  for (let i = 0; i < LENGTH; i++) code += ALPHABET[pick(ALPHABET.length)];
  return `HTL-${code}`;
}