import {
  countNights,
  occupancyError,
  parseDateOnly,
  reservationAdultError,
  roomSubtotal,
  startOfUtcDay,
  stayError,
  sumPrices,
} from './stay-rules';

const d = (s: string) => parseDateOnly(s)!;

describe('stay rules (HTL-16)', () => {
  it('parses only real calendar dates', () => {
    expect(parseDateOnly('2026-12-20')).toBeInstanceOf(Date);
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('20-12-2026')).toBeNull();
  });

  it('counts nights from calendar dates', () => {
    expect(countNights(d('2026-12-20'), d('2026-12-23'))).toBe(3);
    expect(countNights(d('2026-12-31'), d('2027-01-01'))).toBe(1);
  });

  it('rejects check-out not after check-in and past check-in', () => {
    const today = startOfUtcDay(new Date('2026-11-17T10:00:00Z'));
    expect(stayError(d('2026-12-20'), d('2026-12-20'), today)).toMatch(/after/);
    expect(stayError(d('2026-11-16'), d('2026-11-18'), today)).toMatch(/past/);
    expect(stayError(d('2026-11-17'), d('2026-11-18'), today)).toBeNull();
  });

  it('limits adults and children to the room maximums', () => {
    const limits = { maxAdults: 2, maxChildren: 2 };
    expect(
      occupancyError('Deluxe', { adults: 2, childrenAges: [5, 8] }, limits),
    ).toBeNull();
    expect(
      occupancyError('Deluxe', { adults: 3, childrenAges: [] }, limits),
    ).toMatch(/at most 2 adults/);
    expect(
      occupancyError('Deluxe', { adults: 1, childrenAges: [5, 8, 1] }, limits),
    ).toMatch(/at most 2 children/);
    expect(
      occupancyError('Deluxe', { adults: 0, childrenAges: [] }, limits),
    ).toMatch(/at least one guest/);
    expect(
      occupancyError('Adults only', { adults: 1, childrenAges: [4] }, {
        maxAdults: 2,
        maxChildren: 0,
      }),
    ).toMatch(/at most 0 children/);
  });

  it('needs one adult across the reservation, not per room', () => {
    expect(
      reservationAdultError([
        { adults: 1, childrenAges: [] },
        { adults: 0, childrenAges: [10] },
      ]),
    ).toBeNull();
    expect(
      reservationAdultError([{ adults: 0, childrenAges: [10] }]),
    ).toMatch(/at least one adult/);
  });

  it('prices nights x room price without floating-point drift', () => {
    expect(roomSubtotal(19.99, 3)).toBe(59.97);
    expect(sumPrices([roomSubtotal(19.99, 3), roomSubtotal(0.1, 3)])).toBe(
      60.27,
    );
  });
});