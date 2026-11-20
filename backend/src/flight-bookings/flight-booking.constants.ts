/** FLT-22: a hold keeps seats in Pending Payment for 10 minutes. */
export const HOLD_DURATION_MINUTES = 10;

/**
 * The seat hold in Person 3's inventory outlives the booking's hold by this
 * margin. The booking's holdExpiresAt is the deadline that counts; the margin
 * only guarantees that a booking confirmed just before its deadline can still
 * convert its seats (confirmInventory rejects expired inventory holds).
 */
export const INVENTORY_HOLD_GRACE_MINUTES = 2;

/**
 * PAY-04: one platform currency for every price, payment and refund.
 * Payments (Person 7) must charge in this currency as well.
 */
export const PLATFORM_CURRENCY = 'USD';

/** FLT-12: infants pay 10% of the cabin fare and take no seat. */
export const INFANT_FARE_RATIO = 0.1;

/** FLT-12 age bands, in whole years at the outbound departure date. */
export const ADULT_MIN_AGE = 12;
export const CHILD_MIN_AGE = 2;

/** Matches the passenger-count ceiling of flight search (FLT-11). */
export const MAX_PASSENGERS_PER_BOOKING = 100;

export enum TripType {
  ONE_WAY = 'one-way',
  ROUND_TRIP = 'round-trip',
}

export enum SegmentDirection {
  OUTBOUND = 'outbound',
  RETURN = 'return',
}

export enum PassengerType {
  ADULT = 'Adult',
  CHILD = 'Child',
  INFANT = 'Infant',
}

/** Why a Confirmed booking became Cancelled (FLT-26 user, FLT-06 airline). */
export enum CancellationSource {
  USER = 'user',
  FLIGHT_CANCELLED = 'flight-cancelled',
}
