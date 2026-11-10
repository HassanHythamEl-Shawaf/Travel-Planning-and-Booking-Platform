import {
  BOOKING_STATUS,
  BookingStatus,
} from '../integrations/teammate-contracts';

/**
 * The shared booking status set (GEN-11). The values come from the team
 * contract so admin booking inspection (Person 2), hotel bookings (Person 6)
 * and payments (Person 7) all read the same strings.
 */
export const FlightBookingStatus = BOOKING_STATUS;
export type FlightBookingStatus = BookingStatus;

export const FLIGHT_BOOKING_STATUSES: readonly FlightBookingStatus[] =
  Object.values(BOOKING_STATUS);

/**
 * GEN-11: Pending Payment -> Confirmed -> Completed, plus
 * Pending Payment -> Expired and Confirmed -> Cancelled. Nothing else.
 */
const ALLOWED_TRANSITIONS: Readonly<
  Record<FlightBookingStatus, readonly FlightBookingStatus[]>
> = {
  [BOOKING_STATUS.PENDING_PAYMENT]: [
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.EXPIRED,
  ],
  [BOOKING_STATUS.CONFIRMED]: [
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.CANCELLED,
  ],
  [BOOKING_STATUS.COMPLETED]: [],
  [BOOKING_STATUS.EXPIRED]: [],
  [BOOKING_STATUS.CANCELLED]: [],
};

export function canTransition(
  from: FlightBookingStatus,
  to: FlightBookingStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}
