import type { FlightBookingStatus } from './flight-booking-status';

/**
 * Contract between flight bookings (Person 4) and payments / expiry
 * (Person 7). Inject it with:
 *
 *   @Inject(FLIGHT_BOOKING_PAYMENTS) private readonly flights: FlightBookingPayments
 *
 * after importing FlightBookingsModule. Payment flow:
 *   hold (Pending Payment, 10 min) -> accept policies -> pay ->
 *   webhook verifies the PaymentIntent -> confirmBooking(id).
 * A failed payment changes nothing here: the booking stays Pending Payment
 * and the user may retry until holdExpiresAt.
 */
export const FLIGHT_BOOKING_PAYMENTS = Symbol('FLIGHT_BOOKING_PAYMENTS');

/** What payments needs to create or retry a PaymentIntent (PAY-01). */
export interface PayableFlightBooking {
  id: string;
  userId: string;
  status: FlightBookingStatus;
  /** Amount to charge, in `currency` (PAY-04 platform currency). */
  totalPrice: number;
  currency: string;
  /** Payment is only allowed while this is in the future. */
  holdExpiresAt: Date | null;
}

export interface ConfirmedFlightBooking {
  id: string;
  bookingReference: string;
  /** True when this call confirmed it; false when it was already Confirmed (repeated webhook). */
  newlyConfirmed: boolean;
}

export interface FlightBookingPayments {
  /** Throws NotFoundException for an unknown id. */
  getForPayment(bookingId: string): Promise<PayableFlightBooking>;

  /**
   * FLT-23: call only after the webhook verified the PaymentIntent
   * succeeded. Converts held seats to booked seats, issues the booking
   * reference, sets Confirmed and notifies the user. Safe to call twice.
   * Throws ConflictException if the hold already expired or the booking is
   * not Pending Payment (payments should then refund).
   */
  confirmBooking(bookingId: string): Promise<ConfirmedFlightBooking>;

  /**
   * FLT-22: marks an expired Pending Payment booking Expired, releases its
   * seats and notifies the user. Returns false (and changes nothing) when
   * the booking is no longer Pending Payment, e.g. it was just confirmed.
   * Throws ConflictException if the hold has not expired yet.
   */
  releaseHold(bookingId: string): Promise<boolean>;

  /** For the shared ExpiryService cron: releases every expired hold. Returns how many. */
  releaseExpiredHolds(now?: Date): Promise<number>;

  /**
   * GEN-11, for the same cron: Confirmed bookings whose every flight has
   * departed become Completed. Returns how many.
   */
  completeDepartedBookings(now?: Date): Promise<number>;
}
