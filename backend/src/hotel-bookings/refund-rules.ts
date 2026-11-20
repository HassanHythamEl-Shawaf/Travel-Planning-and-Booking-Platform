/**
 * Pure cancellation and refund rules (no Nest, no database).
 * Check-in is a calendar date stored as a UTC midnight; the hotel has no time
 * zone, so check-in time is read as UTC.
 */

export interface CancellationTerms {
  freeCancellationHours: number;
  refundPercentageAfterDeadline: number;
  /** "HH:mm", the hotel's check-in time. */
  checkInTime: string;
  checkOutTime?: string;
  description: string;
}

/** Same defaults as the Hotel schema's cancellationPolicy and checkInTime. */
export const DEFAULT_CANCELLATION_TERMS: CancellationTerms = {
  freeCancellationHours: 24,
  refundPercentageAfterDeadline: 0,
  checkInTime: '14:00',
  checkOutTime: '12:00',
  description: 'Free cancellation up to 24 hours before check-in.',
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MS_PER_HOUR = 60 * 60 * 1000;

/** The moment check-in starts: the check-in date plus the hotel's check-in time. */
export function checkInInstant(checkInDate: Date, checkInTime: string): Date {
  const match =
    TIME.exec(checkInTime) ?? (TIME.exec(DEFAULT_CANCELLATION_TERMS.checkInTime) as RegExpExecArray);
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return new Date(checkInDate.getTime() + minutes * 60 * 1000);
}

/** Last instant at which cancelling still gets a full refund (inclusive). */
export function freeCancellationDeadline(
  checkInDate: Date,
  terms: CancellationTerms,
): Date {
  return new Date(
    checkInInstant(checkInDate, terms.checkInTime).getTime() -
      terms.freeCancellationHours * MS_PER_HOUR,
  );
}

/** 100% up to the free-cancellation deadline, the hotel's after-deadline % later. */
export function refundPercentageFor(
  terms: CancellationTerms,
  checkInDate: Date,
  now: Date,
): number {
  const percentage =
    now.getTime() <= freeCancellationDeadline(checkInDate, terms).getTime()
      ? 100
      : terms.refundPercentageAfterDeadline;
  return Math.min(100, Math.max(0, percentage));
}

/** Refund on the full total, in cents internally so amounts never drift. */
export function refundAmountFor(totalPrice: number, percentage: number): number {
  return Math.round((Math.round(totalPrice * 100) * percentage) / 100) / 100;
}

export const toCents = (amount: number): number => Math.round(amount * 100);

/** HTL-21: a reservation can only be cancelled before the check-in date. */
export function cancellableBeforeCheckIn(checkInDate: Date, now: Date): boolean {
  return now.getTime() < checkInDate.getTime();
}