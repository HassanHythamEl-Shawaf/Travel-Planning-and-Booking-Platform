import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { HOTEL_BOOKING_PAYMENTS } from './hotel-booking-payments.contract';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';
import { HotelBookingHoldService } from './hotel-booking-hold.service';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingQueryService } from './hotel-booking-query.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HOTEL_REFUNDS } from './hotel-refunds.contract';
import { HOTEL_ROOM_READER, HotelsServiceRoomReader } from './hotel-room.reader';
import { RoomInventoryService } from './room-inventory.service';
import { StripeHotelRefundsService } from './stripe-hotel-refunds.service';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';

/**
 * Hotel booking (Person 6: HTL-16 to HTL-21: quote, hold, confirmation, list/details, cancellation). Hotels, rooms and availability
 * are reached only through HOTEL_ROOM_READER, bound to Person 5's
 * HotelsService.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
    AuthModule,
    // Provides HotelsService (must be in HotelsModule's exports).
    HotelsModule,
    NotificationsModule,
    ConfigModule,
    // AuthGuard is instantiated in this module, so its dependencies must be
    // visible here (same as FlightBookingsModule).
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelBookingsService,
    HotelBookingHoldService,
    HotelBookingCancellationService,
    HotelBookingQueryService,
    HotelBookingLifecycleService,
    RoomInventoryService,
    { provide: HOTEL_ROOM_READER, useClass: HotelsServiceRoomReader },
    // PAY-03: refunds the Stripe payment stored on the booking.
    { provide: HOTEL_REFUNDS, useClass: StripeHotelRefundsService },
    // Person 7 (payments) depends on this token only.
    {
      provide: HOTEL_BOOKING_PAYMENTS,
      useExisting: HotelBookingLifecycleService,
    },
  ],
  exports: [HotelBookingsService, HOTEL_BOOKING_PAYMENTS, MongooseModule],
})
export class HotelBookingsModule {}