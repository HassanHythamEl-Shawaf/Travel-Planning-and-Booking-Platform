import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
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
  ],
  controllers: [HotelsController],
  providers: [HotelsService],
  exports: [MongooseModule, HotelsService],
})
export class HotelsModule {}