import { randomInt } from 'node:crypto';

/**
 * Letters and digits without look-alikes (0/O, 1/I/L), so a reference can be
 * read aloud or typed from a printed e-ticket without mistakes.
 */
export const BOOKING_REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const BOOKING_REFERENCE_LENGTH = 6;

const REFERENCE_PATTERN = new RegExp(
  `^[${BOOKING_REFERENCE_ALPHABET}]{${BOOKING_REFERENCE_LENGTH}}$`,
);

/**
 * A random six-character reference (FLT-23), e.g. "K7QM2X". It is generated
 * at confirmation; the unique index on bookingReference rejects the rare
 * collision and the caller retries with a new value.
 */
export function generateBookingReference(
  nextIndex: (max: number) => number = randomInt,
): string {
  let reference = '';
  for (let i = 0; i < BOOKING_REFERENCE_LENGTH; i++) {
    reference +=
      BOOKING_REFERENCE_ALPHABET[nextIndex(BOOKING_REFERENCE_ALPHABET.length)];
  }
  return reference;
}

export function isBookingReference(value: string): boolean {
  return REFERENCE_PATTERN.test(value);
}
