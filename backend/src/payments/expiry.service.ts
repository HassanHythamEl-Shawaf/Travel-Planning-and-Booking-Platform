import { Inject, Injectable } from '@nestjs/common';

import { FLIGHT_BOOKING_PAYMENTS } from '../flight-bookings/flight-booking-payments.contract';
import type { FlightBookingPayments } from '../flight-bookings/flight-booking-payments.contract';

@Injectable()
export class ExpiryService {
  constructor(
    @Inject(FLIGHT_BOOKING_PAYMENTS)
    private readonly bookingPayments: FlightBookingPayments,
  ) {}

  async releaseExpiredHolds(now = new Date()): Promise<number> {
    return this.bookingPayments.releaseExpiredHolds(now);
  }

  async completeDepartedBookings(now = new Date()): Promise<number> {
    return this.bookingPayments.completeDepartedBookings(now);
  }

  async runScheduledChecks(now = new Date()) {
    return {
      released: await this.releaseExpiredHolds(now),
      completed: await this.completeDepartedBookings(now),
    };
  }
}
