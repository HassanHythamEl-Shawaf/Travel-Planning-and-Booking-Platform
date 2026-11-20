import { DateTime } from 'luxon';

import {
  ADULT_MIN_AGE,
  CHILD_MIN_AGE,
  INFANT_FARE_RATIO,
  PassengerType,
} from './flight-booking.constants';

/**
 * Whole years between the date of birth and the travel date, both read as
 * calendar dates. `travelDate` is the outbound departure's local date
 * (YYYY-MM-DD), so a birthday on the travel day already counts. Someone born
 * on 29 February turns a year older on 1 March in non-leap years.
 * Returns null when the birth date is invalid or after the travel date.
 */
export function ageOnDate(
  dateOfBirth: string,
  travelDate: string,
): number | null {
  const birth = DateTime.fromISO(dateOfBirth, { zone: 'utc' }).startOf('day');
  const travel = DateTime.fromISO(travelDate, { zone: 'utc' }).startOf('day');
  if (!birth.isValid || !travel.isValid || birth > travel) return null;
  const beforeBirthday =
    travel.month < birth.month ||
    (travel.month === birth.month && travel.day < birth.day);
  return travel.year - birth.year - (beforeBirthday ? 1 : 0);
}

/** FLT-12: adult 12+, child 2-11, infant under 2. */
export function passengerTypeForAge(age: number): PassengerType {
  if (age >= ADULT_MIN_AGE) return PassengerType.ADULT;
  if (age >= CHILD_MIN_AGE) return PassengerType.CHILD;
  return PassengerType.INFANT;
}

/** Infants sit on an adult's lap; everyone else needs a seat. */
export function occupiesSeat(type: PassengerType): boolean {
  return type !== PassengerType.INFANT;
}

export interface PassengerComposition {
  adults: number;
  children: number;
  infants: number;
  seats: number;
}

export function countPassengers(
  types: readonly PassengerType[],
): PassengerComposition {
  const adults = types.filter((t) => t === PassengerType.ADULT).length;
  const children = types.filter((t) => t === PassengerType.CHILD).length;
  const infants = types.filter((t) => t === PassengerType.INFANT).length;
  return { adults, children, infants, seats: adults + children };
}

/**
 * FLT-12: at least one adult, and no more infants than adults.
 * Returns the rule that is broken, or null when the group is valid.
 */
export function compositionError(
  composition: PassengerComposition,
): string | null {
  if (composition.adults < 1) {
    return 'Each booking needs at least one adult (12+)';
  }
  if (composition.infants > composition.adults) {
    return 'A booking cannot have more infants than adults';
  }
  return null;
}

/** Rounds to cents so stored totals never carry floating-point noise. */
export function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/** FLT-12: adults and children pay the cabin fare, infants pay 10% of it. */
export function fareForPassenger(
  type: PassengerType,
  cabinFare: number,
): number {
  return roundMoney(
    type === PassengerType.INFANT ? cabinFare * INFANT_FARE_RATIO : cabinFare,
  );
}
