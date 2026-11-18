import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import { UsersModule } from '../users/users.module';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HOTEL_ROOM_READER, HotelsServiceRoomReader } from './hotel-room.reader';
import { HotelBooking, HotelBookingSchema } from './schemas/hotel-booking.schema';

/**
 * Hotel booking (Person 6: HTL-16 to HTL-21). Hotels, rooms and availability
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
    // AuthGuard is instantiated in this module, so its dependencies must be
    // visible here (same as FlightBookingsModule).
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [HotelBookingsController],
  providers: [
    HotelBookingsService,
    { provide: HOTEL_ROOM_READER, useClass: HotelsServiceRoomReader },
  ],
  exports: [HotelBookingsService, MongooseModule],
})
export class HotelBookingsModule {}