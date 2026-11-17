import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AirlinesModule } from '../airlines/airlines.module';
import { AuthModule } from '../auth/auth.module';
import { OptionalAuthGuard } from '../blog/optional-auth.guard';
import { FxRatesModule } from '../fx-rates/fx-rates.module';
import { HotelsModule } from '../hotels/hotels.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ItineraryItemsController } from './itinerary-items.controller';
import { ItineraryItemsService } from './itinerary-items.service';
import { ItineraryModerationRegistration } from './itinerary-moderation.handler';
import { ItinerarySearchController } from './itinerary-search.controller';
import { ItinerarySearchService } from './itinerary-search.service';
import { ItineraryBookingsReader } from './itinerary-bookings';
import { ItinerariesController } from './itineraries.controller';
import { ItinerariesService } from './itineraries.service';
import { PublicItinerariesService } from './public-itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

/** Itineraries (ITN-01 to ITN-21), Person 8. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      // Same model as ReportsModule; used to close reports when an owner deletes.
      { name: Report.name, schema: ReportSchema },
    ]),
    AuthModule,
    UsersModule,
    // AuthGuard and OptionalAuthGuard are instantiated here and need JwtService.
    JwtModule.register({}),
    ReferenceDataModule,
    ModerationModule,
    UploadsModule,
    FxRatesModule,
    // ITN-25 / ITN-26 reuse the hotel search (Seif) and flight search (Yahia).
    HotelsModule,
    AirlinesModule,
  ],
  controllers: [
    ItinerariesController,
    ItineraryItemsController,
    ItinerarySearchController,
  ],
  providers: [
    ItinerariesService,
    ItineraryItemsService,
    PublicItinerariesService,
    ItinerarySearchService,
    ItineraryBookingsReader,
    ItineraryModerationRegistration,
    OptionalAuthGuard,
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
