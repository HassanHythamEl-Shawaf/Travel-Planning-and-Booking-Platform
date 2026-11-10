import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

/**
 * Flight booking, seat holds and e-tickets (Person 4: FLT-19 to FLT-26).
 * Inventory is only changed through Person 3's FlightInventoryService.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class FlightBookingsModule {}
