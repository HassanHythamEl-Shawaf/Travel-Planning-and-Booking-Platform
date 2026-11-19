import { HotelBookingStatus } from './hotel-booking-status';

/** Pure review and completion rules (no Nest, no database). */

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_COMMENT_LENGTH = 1000;

/** Two decimals, so a rating filter like "4.5 and up" is never met by 4.46. */
export const roundRating = (value: number): number =>
  Math.round(value * 100) / 100;

/** Average of the ratings, 0 when there are none (the Hotel schema default). */
export function calculateAverage(ratings: number[]): number {
  if (ratings.length === 0) return 0;
  return roundRating(ratings.reduce((sum, r) => sum + r, 0) / ratings.length);
}

/** Trims; an empty comment means "no comment". */
export function normalizeComment(
  comment: string | null | undefined,
): string | null {
  if (typeof comment !== 'string') return null;
  const trimmed = comment.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Defence in depth: the DTO validates too. */
export function reviewInputError(
  rating: number | undefined,
  comment: string | null,
): string | null {
  if (
    rating !== undefined &&
    (!Number.isInteger(rating) || rating < MIN_RATING || rating > MAX_RATING)
  ) {
    return `Rating must be a whole number from ${MIN_RATING} to ${MAX_RATING}`;
  }
  if (comment !== null && comment.length > MAX_COMMENT_LENGTH) {
    return `A review can have at most ${MAX_COMMENT_LENGTH} characters`;
  }
  return null;
}

/**
 * GEN-11: Confirmed -> Completed once the check-out date has passed. Used by
 * the completion job and by the lazy completion when a review is submitted.
 */
export function endedStayFilter(now: Date): Record<string, unknown> {
  return {
    status: HotelBookingStatus.CONFIRMED,
    checkOutDate: { $lte: now },
  };
}

export type ReviewEligibility = 'reviewable' | 'needs-completion' | 'not-reviewable';

/** Completed, or Confirmed after check-out (the job has not caught up yet). */
export function reviewEligibility(
  status: HotelBookingStatus,
  checkOutDate: Date,
  now: Date,
): ReviewEligibility {
  if (status === HotelBookingStatus.COMPLETED) return 'reviewable';
  if (
    status === HotelBookingStatus.CONFIRMED &&
    checkOutDate.getTime() <= now.getTime()
  ) {
    return 'needs-completion';
  }
  return 'not-reviewable';
}