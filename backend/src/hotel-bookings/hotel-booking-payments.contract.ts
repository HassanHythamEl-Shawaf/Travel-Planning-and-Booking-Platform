import type { HotelBookingStatus } from './hotel-booking-status';

/**
 * What the payments module (Person 7) may do with a hotel booking. Inject
 * HOTEL_BOOKING_PAYMENTS after importing HotelBookingsModule; it mirrors
 * FLIGHT_BOOKING_PAYMENTS.
 */
export const HOTEL_BOOKING_PAYMENTS = Symbol('HOTEL_BOOKING_PAYMENTS');

/** Same field names as the flight contract, so payments can treat both alike. */
export interface HotelBookingPaymentInfo {
  id: string;
  /** The booking's owner. */
  userId: string;
  /** Total to charge, in `currency`. */
  totalPrice: number;
  currency: string;
  status: HotelBookingStatus;
  /** End of the Pending Payment hold; null once settled. */
  holdExpiresAt: Date | null;
  policySnapshot: Record<string, unknown>;
}

export interface ConfirmedHotelBooking {
  id: string;
  bookingReference: string;
  status: HotelBookingStatus;
  confirmedAt: Date;
}

export interface HotelBookingPayments {
  getForPayment(id: string): Promise<HotelBookingPaymentInfo>;
  /**
   * Call after the webhook has verified the payment (PAY-01). Confirms the
   * whole reservation at once, issues the reference, books the room dates and
   * sends BOOKING_CONFIRMED. Pass the Stripe PaymentIntent id: it is stored on
   * the booking so a later cancellation can refund exactly that payment
   * (PAY-03). Safe to repeat. Throws ConflictException if the hold already
   * expired or the booking is Cancelled/Expired: refund the payment then.
   */
  confirmBooking(
    id: string,
    paymentIntentId?: string,
  ): Promise<ConfirmedHotelBooking>;
  /**
   * HTL-18: payment failed or was abandoned. If the booking is still Pending
   * Payment it becomes Expired, its rooms are released and BOOKING_EXPIRED is
   * sent. Does nothing for any other status.
   */
  releaseHold(id: string): Promise<void>;
  /**
   * HTL-18: for the expiry job. Expires every Pending Payment booking whose
   * hold has run out and releases its rooms. Returns how many were expired.
   */
  releaseExpiredHolds(now?: Date, excludeBookingIds?: string[]): Promise<number>;
  /**
   * GEN-11, for the expiry job: Confirmed -> Completed for every reservation
   * whose check-out date has passed. Returns how many were completed.
   */
  completeEndedStays(now?: Date): Promise<number>;
}