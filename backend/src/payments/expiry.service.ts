import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { FLIGHT_BOOKING_PAYMENTS } from '../flight-bookings/flight-booking-payments.contract';
import type { FlightBookingPayments } from '../flight-bookings/flight-booking-payments.contract';
import { HOTEL_BOOKING_PAYMENTS } from '../hotel-bookings/hotel-booking-payments.contract';
import type { HotelBookingPayments } from '../hotel-bookings/hotel-booking-payments.contract';
import { PaymentsService } from './payments.service';

@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly payments: PaymentsService,
    @Inject(FLIGHT_BOOKING_PAYMENTS)
    private readonly flights: FlightBookingPayments,
    @Inject(HOTEL_BOOKING_PAYMENTS)
    private readonly hotels: HotelBookingPayments,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledRun(): Promise<void> {
    try {
      await this.runScheduledChecks();
    } catch (error) {
      this.logger.error(
        `Booking expiry run failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async runScheduledChecks(now = new Date()) {
    const protectedBookings = await this.payments.expirePaymentIntents(now);
    const flightExclusions = protectedBookings
      .filter((key) => key.startsWith('flight:'))
      .map((key) => key.slice('flight:'.length));
    const hotelExclusions = protectedBookings
      .filter((key) => key.startsWith('hotel:'))
      .map((key) => key.slice('hotel:'.length));

    const [expiredFlights, expiredHotels, completedFlights, completedHotels] =
      await Promise.all([
        this.flights.releaseExpiredHolds(now, flightExclusions),
        this.hotels.releaseExpiredHolds(now, hotelExclusions),
        this.flights.completeDepartedBookings(now),
        this.hotels.completeEndedStays(now),
      ]);
    return {
      expiredFlights,
      expiredHotels,
      completedFlights,
      completedHotels,
      protectedBookings: protectedBookings.length,
    };
  }
}
