import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';

@ApiTags('Hotel Bookings')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly bookings: HotelBookingsService) {}

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
}