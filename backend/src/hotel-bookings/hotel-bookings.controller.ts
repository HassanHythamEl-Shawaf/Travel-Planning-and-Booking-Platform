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
import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import {
  HotelBookingHold,
  HotelBookingHoldService,
} from './hotel-booking-hold.service';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel Bookings')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly bookings: HotelBookingsService,
    private readonly holds: HotelBookingHoldService,
  ) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Preview a multi-room booking summary (HTL-16)',
    description:
      "Validates the rooms, the adults and children (ages 0-17) assigned to each room, and the dates, then returns the price: for each room nights x that room's current price, summed. At least one adult per reservation; no room may exceed its maximum occupancy. Rooms already held, booked or blocked for the dates are rejected. Nothing is saved and no rooms are held.",
  })
  @ApiOkResponse({ description: 'Price summary with one line per room' })
  @ApiBadRequestResponse({
    description:
      'Invalid dates, guests over a room maximum, no adult, or a room that is inactive or belongs to another hotel',
  })
  @ApiConflictResponse({
    description: 'A room is held, booked or blocked for part of the stay',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  quote(@Body() dto: QuoteHotelBookingDto) {
    return this.bookings.quote(dto);
  }

  @Post()
  @ApiOperation({
    summary: 'Hold the selected rooms and create a Pending Payment booking (HTL-18)',
    description:
      'Same body and validation as the quote. Atomically holds every room for 10 minutes as one Pending Payment reservation. If any room overlaps a Confirmed reservation, an unexpired hold or a blocked range, the whole request is rejected and nothing is held. Pay before holdExpiresAt or the booking becomes Expired and the rooms are released.',
  })
  @ApiCreatedResponse({
    description: 'The Pending Payment booking with its holdExpiresAt',
  })
  @ApiBadRequestResponse({
    description: 'Invalid dates or guests, or a room that is inactive or belongs to another hotel',
  })
  @ApiConflictResponse({
    description: 'A room is held, booked or blocked for part of the stay; nothing was held',
  })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  hold(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: QuoteHotelBookingDto,
  ): Promise<HotelBookingHold> {
    return this.holds.hold(user.sub, dto);
  }
}