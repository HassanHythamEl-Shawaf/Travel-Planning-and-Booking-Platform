import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ModeratorAssignmentsModule } from '../moderator-assignments/moderator-assignments.module';
import { UploadsModule } from '../uploads/uploads.module';
import { RoomInventoryService } from '../hotel-bookings/room-inventory.service';
import { UsersModule } from '../users/users.module';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { Room, RoomSchema } from './schemas/room.schema';
import { RoomAvailability, RoomAvailabilitySchema } from './schemas/room-availability.schema';
import { HotelsService } from './hotels.service';
import { HotelsController } from './hotels.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: Room.name, schema: RoomSchema },
      { name: RoomAvailability.name, schema: RoomAvailabilitySchema },
    ]),
    // For the hotel photo routes (Person 8): AuthGuard and
    // ProviderOwnershipGuard are instantiated here, and photos are stored
    // through the shared upload module (GEN-08), bound to HOTEL_PHOTO_STORE.
    AuthModule,
    UsersModule,
    ModeratorAssignmentsModule,
    JwtModule.register({}),
    UploadsModule,
  ],
  controllers: [HotelsController],
  providers: [HotelsService, RoomInventoryService],
  exports: [MongooseModule, HotelsService, RoomInventoryService],
})
export class HotelsModule {}