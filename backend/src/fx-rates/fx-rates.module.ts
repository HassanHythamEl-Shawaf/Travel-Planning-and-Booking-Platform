import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { UsersModule } from '../users/users.module';
import { HttpFxRatesClient } from './fx-rates.client';
import { FX_RATES_CLIENT } from './fx-rates.constants';
import { FxRatesService } from './fx-rates.service';
import {
  FxRateSnapshot,
  FxRateSnapshotSchema,
} from './schemas/fx-rate-snapshot.schema';

/** ITN-18 exchange rates (Person 8). Tests replace FX_RATES_CLIENT with a fake. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FxRateSnapshot.name, schema: FxRateSnapshotSchema },
    ]),
    ReferenceDataModule,
    UsersModule,
  ],
  providers: [
    FxRatesService,
    HttpFxRatesClient,
    { provide: FX_RATES_CLIENT, useExisting: HttpFxRatesClient },
  ],
  exports: [FxRatesService],
})
export class FxRatesModule {}
