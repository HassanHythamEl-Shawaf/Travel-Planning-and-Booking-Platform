import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { HOTEL_BOOKING_PAYMENTS } from './hotel-booking-payments.contract';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HOTEL_ROOM_READER, HotelsServiceRoomReader } from './hotel-room.reader';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';

/**
 * Hotel booking . Hotels, rooms and availability
 * are reached only through HOTEL_ROOM_READER, bound to HotelsService.
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
    // AuthGuard is instantiated in this module, so its dependencies must be
    // visible here (same as FlightBookingsModule).
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelBookingsService,
    HotelBookingLifecycleService,
    { provide: HOTEL_ROOM_READER, useClass: HotelsServiceRoomReader },
    // Payments depends on this token only.
    {
      provide: HOTEL_BOOKING_PAYMENTS,
      useExisting: HotelBookingLifecycleService,
    },
  ],
  exports: [HotelBookingsService, HOTEL_BOOKING_PAYMENTS, MongooseModule],
})
export class HotelBookingsModule {}