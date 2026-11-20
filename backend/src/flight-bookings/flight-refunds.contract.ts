import type { CancellationSource } from './flight-booking.constants';

/**
 * Contract from flight bookings (Person 4) to refunds (Person 7, PAY-03).
 * Person 7 owns the calculation and the Stripe refund. Until the payments
 * module binds its own implementation to FLIGHT_REFUNDS (in
 * FlightBookingsModule), AirlineTierRefunds computes the amount from the
 * airline's tiers and only logs that no Stripe refund was issued.
 */
export const FLIGHT_REFUNDS = Symbol('FLIGHT_REFUNDS');

export interface FlightRefundRequest {
  bookingId: string;
  userId: string;
  bookingReference: string | null;
  /** Outbound airline; its tiers apply to the whole trip (FLT-12). */
  airlineId: string;
  /** Outbound departure (UTC); tiers count days before it (FLT-09). */
  departureAt: Date;
  totalPrice: number;
  currency: string;
  /** USER: airline tiers (FLT-26). FLIGHT_CANCELLED: 100% (FLT-06). */
  source: CancellationSource;
}

export interface FlightRefundQuote {
  /** Whole days left before the outbound departure. */
  daysBeforeDeparture: number;
  refundPercentage: number;
  refundAmount: number;
  currency: string;
}

export interface IssuedFlightRefund {
  /** Person 7's refund record id, or null when no refund was issued. */
  refundId: string | null;
  /** Pending, Refunded or Failed (PAY-03), or null when not issued. */
  status: string | null;
}

export interface FlightRefunds {
  /** Shown to the user before they confirm a cancellation. */
  previewRefund(
    request: FlightRefundRequest,
    now?: Date,
  ): Promise<FlightRefundQuote>;
  /** Called after the booking is Cancelled, only for a positive amount. */
  issueRefund(
    request: FlightRefundRequest,
    quote: FlightRefundQuote,
  ): Promise<IssuedFlightRefund>;
}
