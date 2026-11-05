import { Module } from '@nestjs/common';

import { BOOKING_DIRECTORY, MongoBookingDirectory } from './booking-directory';
import {
  MongoProviderDirectory,
  PROVIDER_DIRECTORY,
} from './provider-directory';

/** Adapters over collections owned by other team members (see teammate-contracts.ts). */
@Module({
  providers: [
    { provide: PROVIDER_DIRECTORY, useClass: MongoProviderDirectory },
    { provide: BOOKING_DIRECTORY, useClass: MongoBookingDirectory },
  ],
  exports: [PROVIDER_DIRECTORY, BOOKING_DIRECTORY],
})
export class IntegrationsModule {}
