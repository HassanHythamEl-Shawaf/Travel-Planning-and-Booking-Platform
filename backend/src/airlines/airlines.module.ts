import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { ModeratorAssignmentsModule } from '../moderator-assignments/moderator-assignments.module';
import { UsersModule } from '../users/users.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { AIRLINE_LOGO_STORE } from './airline-logo-store';
import { AirlinesController } from './airlines.controller';
import { FlightCompatibilityController } from './flight-compatibility.controller';
import { AirlinesService } from './airlines.service';
import { FlightsController } from './flights.controller';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { Flight, FlightSchema } from './schemas/flight.schema';
import {
  FlightInventoryHold,
  FlightInventoryHoldSchema,
} from './schemas/flight-inventory-hold.schema';
import { FlightInventoryService, FLIGHT_INVENTORY } from './flight-inventory';
import { FLIGHT_PASSENGER_READER } from './flight-passenger-reader';
import { FLIGHT_BOOKING_CANCELLER } from './flight-booking-canceller';
import { FLIGHT_BOOKING_READER } from './flight-booking-reader';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightInventoryHold.name, schema: FlightInventoryHoldSchema },
    ]),
    AuthModule,
    UsersModule,
    ReferenceDataModule,
    ModeratorAssignmentsModule,
    // AuthGuard and ProviderOwnershipGuard are instantiated in this module.
    JwtModule.register({}),
    NotificationsModule,
  ],
  controllers: [
    AirlinesController,
    FlightsController,
    FlightCompatibilityController,
  ],
  providers: [
    AirlinesService,
    FlightInventoryService,
    { provide: FLIGHT_INVENTORY, useExisting: FlightInventoryService },
    // TODO(Person 4): bind FLIGHT_PASSENGER_READER to the booking adapter.
    { provide: FLIGHT_PASSENGER_READER, useValue: null },
    // TODO(Person 4): bind FLIGHT_BOOKING_CANCELLER to the booking adapter.
    { provide: FLIGHT_BOOKING_CANCELLER, useValue: null },
    // TODO(Person 4): bind FLIGHT_BOOKING_READER to the flight booking adapter.
    { provide: FLIGHT_BOOKING_READER, useValue: null },
    // TODO(Person 8): replace this null binding with the shared image-upload adapter.
    { provide: AIRLINE_LOGO_STORE, useValue: null },
  ],
  exports: [
    AirlinesService,
    FlightInventoryService,
    FLIGHT_INVENTORY,
    MongooseModule,
  ],
})
export class AirlinesModule {}
