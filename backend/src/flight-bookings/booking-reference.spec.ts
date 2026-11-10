import {
  BOOKING_REFERENCE_ALPHABET,
  generateBookingReference,
  isBookingReference,
} from './booking-reference';

describe('booking reference (FLT-23)', () => {
  it('generates six unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const reference = generateBookingReference();
      expect(reference).toHaveLength(6);
      expect(isBookingReference(reference)).toBe(true);
      expect(reference).not.toMatch(/[01ILO]/);
    }
  });

  it('draws each character from the injected random source', () => {
    const indexes = [0, 1, 2, 3, 4, BOOKING_REFERENCE_ALPHABET.length - 1];
    expect(generateBookingReference(() => indexes.shift()!)).toBe('ABCDE9');
  });

  it('rejects malformed references', () => {
    expect(isBookingReference('ABC12')).toBe(false);
    expect(isBookingReference('abcdef')).toBe(false);
    expect(isBookingReference('ABCDEO')).toBe(false);
  });
});
