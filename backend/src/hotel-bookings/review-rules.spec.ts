import { HotelBookingStatus } from './hotel-booking-status';
import {
  calculateAverage,
  endedStayFilter,
  normalizeComment,
  reviewEligibility,
  reviewInputError,
  roundRating,
} from './review-rules';

const NOW = new Date('2026-11-18T10:00:00Z');

describe('review rules (HTL-23)', () => {
  it('averages ratings to two decimals, and 0 when there are none', () => {
    expect(calculateAverage([])).toBe(0);
    expect(calculateAverage([5])).toBe(5);
    expect(calculateAverage([5, 2])).toBe(3.5);
    expect(calculateAverage([5, 4, 4])).toBe(4.33);
    expect(roundRating(4.456)).toBe(4.46);
  });

  it('trims comments and treats a blank one as no comment', () => {
    expect(normalizeComment('  great stay  ')).toBe('great stay');
    expect(normalizeComment('   ')).toBeNull();
    expect(normalizeComment('')).toBeNull();
    expect(normalizeComment(undefined)).toBeNull();
    expect(normalizeComment(null)).toBeNull();
  });

  it('accepts whole ratings 1-5 and comments up to 1000 characters', () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(reviewInputError(rating, null)).toBeNull();
    }
    expect(reviewInputError(5, 'x'.repeat(1000))).toBeNull();
    expect(reviewInputError(undefined, 'only a comment')).toBeNull();
  });

  it('rejects ratings outside 1-5, fractions, and comments over 1000', () => {
    for (const rating of [0, 6, -1, 3.5, Number.NaN]) {
      expect(reviewInputError(rating, null)).toMatch(/whole number/);
    }
    expect(reviewInputError(5, 'x'.repeat(1001))).toMatch(/1000/);
  });

  it('allows a review for Completed, or Confirmed after check-out', () => {
    const ended = new Date('2026-11-18T10:00:00Z');
    const later = new Date('2026-11-20T00:00:00Z');
    expect(reviewEligibility(HotelBookingStatus.COMPLETED, later, NOW)).toBe(
      'reviewable',
    );
    expect(reviewEligibility(HotelBookingStatus.CONFIRMED, ended, NOW)).toBe(
      'needs-completion',
    );
    expect(reviewEligibility(HotelBookingStatus.CONFIRMED, later, NOW)).toBe(
      'not-reviewable',
    );
    for (const status of [
      HotelBookingStatus.PENDING_PAYMENT,
      HotelBookingStatus.CANCELLED,
      HotelBookingStatus.EXPIRED,
    ]) {
      expect(reviewEligibility(status, new Date('2026-01-01T00:00:00Z'), NOW)).toBe(
        'not-reviewable',
      );
    }
  });

  it('completes only Confirmed stays whose check-out has passed', () => {
    expect(endedStayFilter(NOW)).toEqual({
      status: HotelBookingStatus.CONFIRMED,
      checkOutDate: { $lte: NOW },
    });
  });
});