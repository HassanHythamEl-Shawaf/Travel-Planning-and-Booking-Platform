import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaymentsService } from './payments.service';

class CreatePaymentIntentDto {
  bookingId!: string;
}

class AcceptPoliciesDto {
  userId!: string;
  policyVersion?: string;
}

@Controller('bookings')
export class BookingPolicyController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':type/:id/policies')
  async getPolicies(
    @Param('type') type: 'flight' | 'hotel',
    @Param('id') bookingId: string,
  ) {
    return this.paymentsService.getPolicySummary(type, bookingId);
  }

  @Post(':type/:id/accept-policies')
  async acceptPolicies(
    @Param('type') type: 'flight' | 'hotel',
    @Param('id') bookingId: string,
    @Body() dto: AcceptPoliciesDto,
  ) {
    if (!dto?.userId) {
      throw new BadRequestException('userId is required');
    }
    return this.paymentsService.acceptPolicies(
      type,
      bookingId,
      dto.userId,
      dto.policyVersion ?? 'v1',
    );
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('bookings/:type/:id/policies')
  async getPolicies(
    @Param('type') type: 'flight' | 'hotel',
    @Param('id') bookingId: string,
  ) {
    return this.paymentsService.getPolicySummary(type, bookingId);
  }

  @Post('bookings/:type/:id/accept-policies')
  async acceptPolicies(
    @Param('type') type: 'flight' | 'hotel',
    @Param('id') bookingId: string,
    @Body() dto: AcceptPoliciesDto,
  ) {
    if (!dto?.userId) {
      throw new BadRequestException('userId is required');
    }
    return this.paymentsService.acceptPolicies(
      type,
      bookingId,
      dto.userId,
      dto.policyVersion ?? 'v1',
    );
  }

  @Post('intent')
  async createIntent(@Body() dto: CreatePaymentIntentDto) {
    if (!dto?.bookingId) {
      throw new BadRequestException('bookingId is required');
    }
    return this.paymentsService.createPaymentIntent(dto.bookingId);
  }

  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer; body?: Buffer }) {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody ?? (req.body as Buffer | undefined);

    if (!signature || !rawBody) {
      throw new BadRequestException('Stripe signature and raw body are required');
    }

    return this.paymentsService.handleWebhook(
      rawBody,
      Array.isArray(signature) ? signature[0] : signature,
    );
  }
}
