export const BOOKING_ELIGIBILITY_READER = Symbol('BOOKING_ELIGIBILITY_READER');

export interface BookingEligibilityReader {
  hasUpcomingConfirmedBookings(userId: string): Promise<boolean>;
}
