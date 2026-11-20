import { forwardRef, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AirlinesModule } from '../airlines/airlines.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ConfigModule } from '@nestjs/config';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingReaders } from './flight-booking-readers';
import { FLIGHT_BOOKING_PAYMENTS } from './flight-booking-payments.contract';
import { FLIGHT_REFUNDS } from './flight-refunds.contract';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightBookingsService } from './flight-bookings.service';
import { StripeRefundsService } from './stripe-refunds.service';
import { Payment, PaymentSchema, Refund, RefundSchema } from '../payments/payment.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

/**
 * Flight booking, seat holds and e-tickets (Person 4: FLT-19 to FLT-26).
 * Inventory is only changed through Person 3's FlightInventoryService;
 * flights and airlines are read through the models AirlinesModule exports.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
    // Inventory and flight models; AirlinesModule uses this module's adapters.
    forwardRef(() => AirlinesModule),
    AuthModule,
    // AuthGuard is instantiated in this module, so its dependencies
    // (JwtService, UsersService) must be visible here.
    UsersModule,
    JwtModule.register({}),
    NotificationsModule,
    ConfigModule,
  ],
  controllers: [FlightBookingsController],
  providers: [
    FlightBookingsService,
    FlightBookingLifecycleService,
    FlightBookingCancellationService,
    FlightBookingReaders,
    { provide: FLIGHT_REFUNDS, useClass: StripeRefundsService },
    // Person 7 (payments, ExpiryService) depends on this token only.
    {
      provide: FLIGHT_BOOKING_PAYMENTS,
      useExisting: FlightBookingLifecycleService,
    },
  ],
  exports: [
    FlightBookingsService,
    FLIGHT_BOOKING_PAYMENTS,
    // Person 3's flight module binds its booking adapters to these two.
    FlightBookingCancellationService,
    FlightBookingReaders,
    MongooseModule,
  ],
})
export class FlightBookingsModule {}
