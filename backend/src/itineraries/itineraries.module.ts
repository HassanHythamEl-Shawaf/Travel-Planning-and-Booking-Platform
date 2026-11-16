import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { OptionalAuthGuard } from '../blog/optional-auth.guard';
import { FxRatesModule } from '../fx-rates/fx-rates.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { UploadsModule } from '../uploads/uploads.module';
import { UsersModule } from '../users/users.module';
import { ItineraryItemsController } from './itinerary-items.controller';
import { ItineraryItemsService } from './itinerary-items.service';
import { ItineraryModerationRegistration } from './itinerary-moderation.handler';
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
  ],
  controllers: [ItinerariesController, ItineraryItemsController],
  providers: [
    ItinerariesService,
    ItineraryItemsService,
    PublicItinerariesService,
    ItineraryModerationRegistration,
    OptionalAuthGuard,
  ],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
