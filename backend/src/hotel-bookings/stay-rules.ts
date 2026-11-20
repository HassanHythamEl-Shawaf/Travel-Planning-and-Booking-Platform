/**
 * Pure rules for HTL-16 (no Nest, no database), so they are easy to unit test.
 * Dates are calendar dates (YYYY-MM-DD) handled as UTC midnights, so a night
 * count never shifts with the server's time zone.
 */

export const MAX_CHILD_AGE = 17;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RoomGuests {
  adults: number;
  childrenAges: number[];
}

/** Returns null for anything that is not a real YYYY-MM-DD calendar date. */
export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function countNights(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY);
}

/** Minimal date sanity; HTL-17 adds the remaining date rules. */
export function stayError(
  checkIn: Date,
  checkOut: Date,
  today: Date,
): string | null {
  if (checkOut.getTime() <= checkIn.getTime()) {
    return 'Check-out must be after check-in';
  }
  if (checkIn.getTime() < today.getTime()) {
    return 'Check-in cannot be in the past';
  }
  return null;
}

export function guestTotal(guests: RoomGuests): number {
  return guests.adults + guests.childrenAges.length;
}

/** A room's limits, as modelled by the hotels module (Room.occupancy). */
export interface RoomLimits {
  maxAdults: number;
  maxChildren: number;
}

/** A room must hold someone, and never more adults or children than its limits. */
export function occupancyError(
  roomName: string,
  guests: RoomGuests,
  limits: RoomLimits,
): string | null {
  if (guestTotal(guests) < 1) {
    return `Room "${roomName}" needs at least one guest`;
  }
  if (guests.adults > limits.maxAdults) {
    return `Room "${roomName}" holds at most ${limits.maxAdults} adults`;
  }
  if (guests.childrenAges.length > limits.maxChildren) {
    return `Room "${roomName}" holds at most ${limits.maxChildren} children`;
  }
  return null;
}

/** At least one adult across the whole reservation (not per room). */
export function reservationAdultError(rooms: RoomGuests[]): string | null {
  const adults = rooms.reduce((sum, room) => sum + room.adults, 0);
  return adults >= 1 ? null : 'A reservation needs at least one adult';
}

/** nights x room price, computed in cents to avoid floating-point drift. */
export function roomSubtotal(pricePerNight: number, nights: number): number {
  return (Math.round(pricePerNight * 100) * nights) / 100;
}

export function sumPrices(prices: number[]): number {
  return prices.reduce((sum, price) => sum + Math.round(price * 100), 0) / 100;
}