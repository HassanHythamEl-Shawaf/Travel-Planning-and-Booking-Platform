export const FLIGHT_PASSENGER_READER = Symbol('FLIGHT_PASSENGER_READER');

/**
 * TODO(Person 4): implement this reader against confirmed flight bookings.
 * The flight module must not query the booking collection directly.
 */
export interface FlightPassengerReader {
  findConfirmedPassengerIds(flightId: string): Promise<string[]>;
}
