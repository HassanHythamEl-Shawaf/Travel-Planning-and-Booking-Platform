import { generateBookingReference } from './booking-reference';

describe('generateBookingReference (HTL-17)', () => {
  it('has the HTL- prefix and 8 unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateBookingReference()).toMatch(
        /^HTL-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/,
      );
    }
  });

  it('is built from the injected randomness', () => {
    expect(generateBookingReference(() => 0)).toBe('HTL-AAAAAAAA');
  });

  it('does not repeat across many calls', () => {
    const refs = new Set(
      Array.from({ length: 2000 }, () => generateBookingReference()),
    );
    expect(refs.size).toBe(2000);
  });
});