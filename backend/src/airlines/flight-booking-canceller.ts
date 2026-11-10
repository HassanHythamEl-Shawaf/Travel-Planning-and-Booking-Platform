export const FLIGHT_BOOKING_CANCELLER = Symbol('FLIGHT_BOOKING_CANCELLER');

/**
 * TODO(Person 4): bind this adapter to confirmed-flight booking cancellation.
 * TODO(Person 7): bind the refund workflow after booking cancellation.
 */
export interface FlightBookingCanceller {
  cancelConfirmedBookings(flightId: string): Promise<void>;
}
