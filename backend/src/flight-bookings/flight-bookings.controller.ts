import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
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
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import {
  FlightBookingResponseDto,
  FlightBookingSummaryDto,
} from './dto/flight-booking-response.dto';
import {
  FlightBookingDetailsDto,
  FlightBookingListResponseDto,
  ListFlightBookingsQueryDto,
} from './dto/list-flight-bookings.dto';
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

  @Get()
  @ApiOperation({
    summary: 'List my flight bookings by group (FLT-25)',
    description:
      'Upcoming: Confirmed and not yet departed, or Pending Payment with a running hold. Past: Completed, or Confirmed after departure. Cancelled: Cancelled or Expired. 10 per page, with the size of every group in `counts`.',
  })
  @ApiOkResponse({ type: FlightBookingListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid group or page' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFlightBookingsQueryDto,
  ): Promise<FlightBookingListResponseDto> {
    return this.bookings.listMine(user.sub, query.group!, query.page);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get my flight booking details (FLT-25)',
    description:
      "Full details of one of your bookings. Another user's booking is reported as not found (ACC-11).",
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ type: FlightBookingDetailsDto })
  @ApiBadRequestResponse({ description: 'Invalid booking id' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  details(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingDetailsDto> {
    return this.bookings.getMine(user.sub, id);
  }
}
