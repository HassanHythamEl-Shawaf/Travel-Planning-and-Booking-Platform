import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import Stripe from 'stripe';

import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { ExpiryService } from './expiry.service';
import {
  BookingPolicyController,
  PaymentsController,
} from './payments.controller';
import { PaymentsService, STRIPE_CLIENT } from './payments.service';
import { PolicyAcceptance, PolicyAcceptanceSchema } from './policy-acceptance.schema';
import { PolicyAcceptanceService } from './policy-acceptance.service';

@Module({
  imports: [
    ConfigModule,
    FlightBookingsModule,
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
    ]),
  ],
  controllers: [PaymentsController, BookingPolicyController],
  providers: [
    {
      provide: STRIPE_CLIENT,
      useFactory: (config: ConfigService) =>
        new Stripe(config.getOrThrow<string>('STRIPE_SECRET_KEY')),
      inject: [ConfigService],
    },
    PaymentsService,
    PolicyAcceptanceService,
    ExpiryService,
  ],
  exports: [PaymentsService, PolicyAcceptanceService, ExpiryService],
})
export class PaymentsModule {}
