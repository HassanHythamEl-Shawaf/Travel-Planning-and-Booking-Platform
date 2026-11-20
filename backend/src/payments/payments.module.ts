import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { ExpiryService } from './expiry.service';
import {
  BookingPolicyController,
  PaymentsController,
  RefundsController,
  StripeWebhookController,
} from './payments.controller';
import { PaymentsService, STRIPE_CLIENT } from './payments.service';
import { PolicyAcceptance, PolicyAcceptanceSchema } from './policy-acceptance.schema';
import { PolicyAcceptanceService } from './policy-acceptance.service';
import { Payment, PaymentSchema, Refund, RefundSchema } from './payment.schema';
import { createStripeTestClient } from './stripe-test-mode';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    UsersModule,
    JwtModule.register({}),
    FlightBookingsModule,
    HotelBookingsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
  ],
  controllers: [
    PaymentsController,
    BookingPolicyController,
    StripeWebhookController,
    RefundsController,
  ],
  providers: [
    {
      provide: STRIPE_CLIENT,
      useFactory: (config: ConfigService) =>
        createStripeTestClient(config.getOrThrow<string>('STRIPE_SECRET_KEY')),
      inject: [ConfigService],
    },
    PaymentsService,
    PolicyAcceptanceService,
    ExpiryService,
  ],
  exports: [PaymentsService, PolicyAcceptanceService, ExpiryService],
})
export class PaymentsModule {}
