/** HTL-20: the three tabs of "My hotel reservations". */
export enum HotelBookingGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

export const HOTEL_BOOKING_GROUPS = Object.values(HotelBookingGroup);