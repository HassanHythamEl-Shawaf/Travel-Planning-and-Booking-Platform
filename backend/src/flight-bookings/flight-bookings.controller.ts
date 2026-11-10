import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import {
  FlightBookingResponseDto,
  FlightBookingSummaryDto,
} from './dto/flight-booking-response.dto';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(private readonly bookings: FlightBookingsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a booking summary (FLT-19, FLT-21)',
    description:
      'Validates passengers (type against date of birth, at least one adult, no more infants than adults) and extra baggage, and returns flights, passengers, baggage and the total. Nothing is saved and no seats are held. Send returnFlight for a round trip.',
  })
  @ApiOkResponse({ type: FlightBookingSummaryDto })
  @ApiBadRequestResponse({
    description: 'Invalid passengers, baggage or round-trip pairing',
  })
  @ApiConflictResponse({
    description: 'Flight not bookable, airline deactivated or not enough seats',
  })
  @ApiNotFoundResponse({ description: 'Flight, airline or cabin not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  summary(
    @Body() dto: CreateFlightBookingDto,
  ): Promise<FlightBookingSummaryDto> {
    return this.bookings.quote(dto);
  }

  @Post('hold')
  @ApiOperation({
    summary: 'Hold seats and create a Pending Payment booking (FLT-22)',
    description:
      'Atomically reserves the seats on every flight of the trip and creates the booking in Pending Payment for 10 minutes. Pay before holdExpiresAt or the booking becomes Expired and the seats are released. A round trip holds both flights or neither.',
  })
  @ApiCreatedResponse({ type: FlightBookingResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid passengers, baggage or round-trip pairing',
  })
  @ApiConflictResponse({
    description: 'Flight not bookable, airline deactivated or not enough seats',
  })
  @ApiNotFoundResponse({ description: 'Flight, airline or cabin not found' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  hold(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFlightBookingDto,
  ): Promise<FlightBookingResponseDto> {
    return this.bookings.hold(user.sub, dto);
  }
}
