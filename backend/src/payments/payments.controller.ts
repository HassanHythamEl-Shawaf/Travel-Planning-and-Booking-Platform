import {
  Body,
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Equals, IsIn, IsMongoId, IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { PaymentsService } from './payments.service';
import type { BookingType } from './payments.service';

class CreatePaymentDto {
  @ApiProperty({ enum: ['flight', 'hotel'], example: 'flight' })
  @IsIn(['flight', 'hotel'])
  bookingType!: BookingType;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  bookingId!: string;
}

class AcceptPoliciesDto {
  @ApiProperty({ enum: [true], description: 'Must be true to accept the policies.' })
  @Equals(true)
  accepted!: true;

  @ApiPropertyOptional({ example: 'v1', default: 'v1' })
  @IsOptional()
  @IsString()
  policyVersion?: string;
}

@ApiTags('Payments & Policies')
@Controller('bookings')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@ApiCookieAuth('access_token')
export class BookingPolicyController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':type/:id/policies')
  @ApiOperation({ summary: 'Get booking policies before payment (PAY-02)' })
  @ApiOkResponse({ description: 'Provider policies, booking amount, and existing acceptance' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Booking owner required' })
  getPolicies(
    @Param('type') type: BookingType,
    @Param('id') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.getPolicySummary(type, bookingId, user.sub);
  }

  @Post(':type/:id/accept-policies')
  @ApiOperation({ summary: 'Record acceptance of booking policies (PAY-02)' })
  @ApiOkResponse({ description: 'Stored policy version and acceptance timestamp' })
  @ApiBadRequestResponse({ description: 'Acceptance must be true' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Booking owner required' })
  acceptPolicies(
    @Param('type') type: BookingType,
    @Param('id') bookingId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AcceptPoliciesDto,
  ) {
    return this.payments.acceptPolicies(
      type,
      bookingId,
      user.sub,
      dto.policyVersion ?? 'v1',
    );
  }
}

@ApiTags('Payments')
@Controller('payments')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@ApiCookieAuth('access_token')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a Stripe PaymentIntent (PAY-01)' })
  @ApiCreatedResponse({ description: 'PaymentIntent client secret and payment status' })
  @ApiBadRequestResponse({ description: 'Invalid booking type or id' })
  @ApiForbiddenResponse({ description: 'Booking owner and accepted policies required' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  create(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.createPaymentIntent(
      dto.bookingType,
      dto.bookingId,
      user.sub,
    );
  }

  @Post('intent')
  @ApiOperation({ summary: 'Compatibility alias for creating a PaymentIntent (PAY-01)' })
  @ApiCreatedResponse({ description: 'PaymentIntent client secret and payment status' })
  createIntent(
    @Body() dto: CreatePaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.create(dto, user);
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a payment while its hold is active (PAY-01)' })
  @ApiOkResponse({ description: 'Existing PaymentIntent for Stripe client confirmation' })
  @ApiForbiddenResponse({ description: 'Payment owner required' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  retry(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.retryPayment(id, user.sub);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get my payment status (PAY-01)' })
  @ApiOkResponse({ description: 'Payment amount, currency, and status' })
  @ApiForbiddenResponse({ description: 'Payment owner required' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.getPayment(id, user.sub);
  }
}

@ApiTags('Payments')
@Controller('payments')
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify Stripe payment events (PAY-01)' })
  @ApiOkResponse({ description: 'Verified event acknowledgement' })
  @ApiBadRequestResponse({ description: 'Invalid signature or event payload' })
  async webhook(@Req() req: Request & { rawBody?: Buffer }) {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.rawBody;
    if (!signature || !rawBody) {
      throw new BadRequestException('Stripe signature and raw body are required');
    }
    return this.payments.handleWebhook(
      rawBody,
      Array.isArray(signature) ? signature[0] : signature,
    );
  }
}

@ApiTags('Refunds')
@Controller('refunds')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@ApiCookieAuth('access_token')
export class RefundsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get my refund status (PAY-03)' })
  @ApiOkResponse({ description: 'Refund amount, currency, and status' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Refund owner required' })
  get(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.payments.getRefund(id, user.sub);
  }
}
