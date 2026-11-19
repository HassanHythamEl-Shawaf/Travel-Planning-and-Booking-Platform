import { Injectable, Logger } from '@nestjs/common';

/**
 * Contract from hotel bookings  to refunds ( PAY-03),
 * shaped like FLIGHT_REFUNDS. Unlike flights, the refund amount is computed
 * here from the hotel's cancellation terms (HTL-10), snapshotted on the
 * booking. Until the payments module binds its own
 * implementation to HOTEL_REFUNDS (in HotelBookingsModule), PendingHotelRefunds
 * only logs that no refund was issued.
 */
export const HOTEL_REFUNDS = Symbol('HOTEL_REFUNDS');

export interface HotelRefundRequest {
  bookingId: string;
  userId: string;
  bookingReference: string | null;
  hotelId: string;
  /** Full reservation total that was paid. */
  totalPrice: number;
  currency: string;
}

export interface HotelRefundQuote {
  /** Percentage of the full total given back by the hotel's terms. */
  refundPercentage: number;
  /** The amount to refund; always positive when issueRefund is called. */
  refundAmount: number;
  currency: string;
}

export interface IssuedHotelRefund {
  /** Person 7's refund record id, or null when no refund was issued. */
  refundId: string | null;
  /** Pending, Refunded or Failed (PAY-03), or null when not issued. */
  status: string | null;
}

export interface HotelRefunds {
  /** Called after the booking is Cancelled, only for a positive amount. */
  issueRefund(
    request: HotelRefundRequest,
    quote: HotelRefundQuote,
  ): Promise<IssuedHotelRefund>;
}

/** Default until payments binds the real one: moves no money. */
@Injectable()
export class PendingHotelRefunds implements HotelRefunds {
  private readonly logger = new Logger(PendingHotelRefunds.name);

  async issueRefund(
    request: HotelRefundRequest,
    quote: HotelRefundQuote,
  ): Promise<IssuedHotelRefund> {
    this.logger.warn(
      `No refund service bound: ${quote.refundAmount} ${quote.currency} (${quote.refundPercentage}%) for hotel booking ${request.bookingId} was NOT refunded`,
    );
    return { refundId: null, status: null };
  }
}