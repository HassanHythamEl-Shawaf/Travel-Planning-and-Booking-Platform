import {
  cancellableBeforeCheckIn,
  CancellationTerms,
  checkInInstant,
  freeCancellationDeadline,
  refundAmountFor,
  refundPercentageFor,
} from './refund-rules';

const CHECK_IN = new Date('2026-12-20T00:00:00Z');
const terms = (over: Partial<CancellationTerms> = {}): CancellationTerms => ({
  freeCancellationHours: 24,
  refundPercentageAfterDeadline: 50,
  checkInTime: '14:00',
  description: '',
  ...over,
});

describe('refund rules (HTL-21)', () => {
  it('puts check-in at the check-in date plus the hotel check-in time', () => {
    expect(checkInInstant(CHECK_IN, '14:00').toISOString()).toBe(
      '2026-12-20T14:00:00.000Z',
    );
    expect(checkInInstant(CHECK_IN, '09:30').toISOString()).toBe(
      '2026-12-20T09:30:00.000Z',
    );
    // A malformed time falls back to the 14:00 default.
    expect(checkInInstant(CHECK_IN, '25:99').toISOString()).toBe(
      '2026-12-20T14:00:00.000Z',
    );
    expect(checkInInstant(CHECK_IN, 'noon').toISOString()).toBe(
      '2026-12-20T14:00:00.000Z',
    );
  });

  it('ends free cancellation freeCancellationHours before check-in', () => {
    expect(freeCancellationDeadline(CHECK_IN, terms()).toISOString()).toBe(
      '2026-12-19T14:00:00.000Z',
    );
    expect(
      freeCancellationDeadline(
        CHECK_IN,
        terms({ freeCancellationHours: 72 }),
      ).toISOString(),
    ).toBe('2026-12-17T14:00:00.000Z');
  });

  it('refunds 100% up to the deadline (inclusive) and the after-deadline % later', () => {
    const t = terms();
    expect(
      refundPercentageFor(t, CHECK_IN, new Date('2026-11-18T10:00:00Z')),
    ).toBe(100);
    expect(
      refundPercentageFor(t, CHECK_IN, new Date('2026-12-19T14:00:00Z')),
    ).toBe(100);
    expect(
      refundPercentageFor(t, CHECK_IN, new Date('2026-12-19T14:00:01Z')),
    ).toBe(50);
  });

  it('clamps nonsense percentages into 0-100', () => {
    const late = new Date('2026-12-19T23:00:00Z');
    expect(
      refundPercentageFor(terms({ refundPercentageAfterDeadline: 150 }), CHECK_IN, late),
    ).toBe(100);
    expect(
      refundPercentageFor(terms({ refundPercentageAfterDeadline: -5 }), CHECK_IN, late),
    ).toBe(0);
  });

  it('computes the refund on the full total in whole cents', () => {
    expect(refundAmountFor(751.5, 100)).toBe(751.5);
    expect(refundAmountFor(751.5, 50)).toBe(375.75);
    expect(refundAmountFor(100.01, 33)).toBe(33.0);
    expect(refundAmountFor(300, 0)).toBe(0);
  });

  it('allows cancelling only before the check-in date', () => {
    expect(
      cancellableBeforeCheckIn(CHECK_IN, new Date('2026-12-19T23:59:59Z')),
    ).toBe(true);
    expect(cancellableBeforeCheckIn(CHECK_IN, CHECK_IN)).toBe(false);
    expect(
      cancellableBeforeCheckIn(CHECK_IN, new Date('2026-12-20T09:00:00Z')),
    ).toBe(false);
  });
});