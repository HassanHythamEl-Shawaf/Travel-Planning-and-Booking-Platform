/**
 * Same values as BOOKING_STATUS in integrations/teammate-contracts.ts, which
 * admin booking inspection reads. Do not rename them.
 */
export enum HotelBookingStatus {
  PENDING_PAYMENT = 'Pending Payment',
  CONFIRMED = 'Confirmed',
  CANCELLED = 'Cancelled',
  EXPIRED = 'Expired',
  COMPLETED = 'Completed',
}

export const HOTEL_BOOKING_STATUSES = Object.values(HotelBookingStatus);
