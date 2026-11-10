export const FLIGHT_BOOKING_READER = Symbol('FLIGHT_BOOKING_READER');

export interface FlightBookingPassenger {
  id: string;
  name: string;
}

export interface FlightBookingRecord {
  id: string;
  bookingReference: string;
  passengers: FlightBookingPassenger[];
  cabin: string;
  seats: number;
  status: string;
}

/**
 * TODO(Person 4): bind this contract to the booking module once its flight
 * booking schema and passenger projection are available.
 */
export interface FlightBookingReader {
  listByFlightId(flightId: string): Promise<FlightBookingRecord[]>;
}
