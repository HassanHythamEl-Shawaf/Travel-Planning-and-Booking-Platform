/**
 * The ONLY file that knows collection and field names owned by other team
 * members (Persons 3–6). Admin features read and write these collections
 * through the ProviderDirectory / BookingDirectory adapters, so if a teammate
 * names something differently, fix it here and nowhere else.
 */

/**
 * Mongoose default collection names for models `Airline` / `Hotel`.
 * Fields read: `_id` (ObjectId), `name` (string), `isActive` (boolean; missing = true).
 * Field written: `isActive` (ACC-15 provider deactivation).
 */
export const PROVIDER_COLLECTIONS = {
  airline: 'airlines',
  hotel: 'hotels',
} as const;

/**
 * Mongoose default collection names for models `FlightBooking` / `HotelBooking`.
 * Fields read, both: `_id`, `userId` (ObjectId), `status` (string), `createdAt` (Date),
 *   `bookingReference` (string | null), `totalPrice` (number), `currency` (string)
 * flight only: `airlineId` (ObjectId), `departureAt` (Date, outbound segment, UTC)
 * hotel only:  `hotelId` (ObjectId), `checkInDate` (Date)
 */
export const BOOKING_COLLECTIONS = {
  flight: 'flightbookings',
  hotel: 'hotelbookings',
} as const;

/** Provider-specific booking fields, keyed by booking type. */
export const BOOKING_FIELDS = {
  flight: { providerId: 'airlineId', startsAt: 'departureAt' },
  hotel: { providerId: 'hotelId', startsAt: 'checkInDate' },
} as const;

export const BOOKING_STATUS = {
  PENDING_PAYMENT: 'Pending Payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
} as const;

export type BookingStatus =
  (typeof BOOKING_STATUS)[keyof typeof BOOKING_STATUS];

export type BookingType = keyof typeof BOOKING_COLLECTIONS;

/** Users collection (Mongoose default for model `User`), used for lookups. */
export const USERS_COLLECTION = 'users';
