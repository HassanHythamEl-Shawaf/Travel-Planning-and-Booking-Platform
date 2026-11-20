export const FLIGHT_BOOKING_CANCELLER = Symbol('FLIGHT_BOOKING_CANCELLER');

/**
 * TODO(Person 4): bind this adapter to confirmed-flight booking cancellation.
 * TODO(Person 7): bind the refund workflow after booking cancellation.
 */
export interface FlightBookingCanceller {
  /**
   * FLT-06: cancels every Confirmed booking on the flight with a 100% refund
   * and expires its Pending Payment bookings. Returns the ids of the users
   * affected, to be notified by the caller (it sends nothing itself).
   */
  cancelConfirmedBookings(flightId: string): Promise<string[]>;
}
