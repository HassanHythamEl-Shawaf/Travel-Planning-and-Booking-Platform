import { forwardRef, Module } from '@nestjs/common';
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
import { FlightBookingCancellationService } from '../flight-bookings/flight-booking-cancellation.service';
import { FlightBookingReaders } from '../flight-bookings/flight-booking-readers';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { AirlineLogoUploadAdapter } from '../uploads/adapters/airline-logo.adapter';
import { UploadsModule } from '../uploads/uploads.module';

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
    // Person 4's booking adapters; FlightBookingsModule imports this module too.
    forwardRef(() => FlightBookingsModule),
    // Person 8's shared image upload module (GEN-08), for the airline logo.
    UploadsModule,
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
    { provide: FLIGHT_PASSENGER_READER, useExisting: FlightBookingReaders },
    {
      provide: FLIGHT_BOOKING_CANCELLER,
      useExisting: FlightBookingCancellationService,
    },
    { provide: FLIGHT_BOOKING_READER, useExisting: FlightBookingReaders },
    // Logo upload via PUT /airlines/:id/logo; a direct logoUrl is rejected (400).
    { provide: AIRLINE_LOGO_STORE, useExisting: AirlineLogoUploadAdapter },
  ],
  exports: [
    AirlinesService,
    FlightInventoryService,
    FLIGHT_INVENTORY,
    MongooseModule,
  ],
})
export class AirlinesModule {}
