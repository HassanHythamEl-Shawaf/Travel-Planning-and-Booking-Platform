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

/**
 * Content collections read and written by the moderation default handlers
 * (GEN-09 / GEN-10). Posts, comments and likes belong to the Blog module
 * (Wael), reviews to Yassin (Person 6), itineraries to Hammad (Person 8).
 * Owners replace the defaults by registering their own ModerationHandler.
 *
 * Fields read / written by the default handlers (missing isHidden = false):
 * posts:       _id, authorId (ObjectId), title (string), content (string),
 *              status ('draft' | 'published'), isHidden (boolean)
 * comments:    _id, postId (ObjectId), authorId (ObjectId), content (string), isHidden
 * likes:       postId (ObjectId), userId (ObjectId)
 * reviews:     _id, userId (ObjectId), hotelId (ObjectId), comment (string), isHidden
 * itineraries: _id, ownerId (ObjectId), title (string), isPublic (boolean), isHidden
 */
export const CONTENT_COLLECTIONS = {
  post: 'posts', // Blog (Wael). Mongoose model Post
  comment: 'comments', // Blog (Wael). Mongoose model Comment
  like: 'likes', // Blog (Wael). Mongoose model Like; used only by the post delete cascade
  review: 'reviews', // Yassin (Person 6). Mongoose model Review
  itinerary: 'itineraries', // Hammad (Person 8). Mongoose model Itinerary
} as const;

export const POST_STATUS = { DRAFT: 'draft', PUBLISHED: 'published' } as const;

/**
 * Itinerary fields read by the Blog author page (BLG-12) through
 * blog/public-itinerary.reader.ts, on top of the moderation fields above.
 * `countries` (string[]) and `createdAt` (Date) are optional: a missing
 * value is returned as [] / null. Sorted newest first by createdAt, then _id.
 */
export const ITINERARY_FIELDS = {
  ownerId: 'ownerId',
  title: 'title',
  isPublic: 'isPublic',
  isHidden: 'isHidden',
  countries: 'countries',
  createdAt: 'createdAt',
} as const;
