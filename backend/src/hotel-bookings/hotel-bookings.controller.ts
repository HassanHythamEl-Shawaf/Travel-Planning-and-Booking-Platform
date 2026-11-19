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
import { CancelHotelBookingDto } from './dto/cancel-hotel-booking.dto';
import { ListHotelBookingsQueryDto } from './dto/list-hotel-bookings.dto';
import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { HotelBookingHoldService } from './hotel-booking-hold.service';
import type { HotelBookingHold } from './hotel-booking-hold.service';
import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';
import type {
  HotelCancellationResult,
  HotelRefundPreview,
} from './hotel-booking-cancellation.service';
import { HotelBookingQueryService } from './hotel-booking-query.service';
import type { HotelBookingList } from './hotel-booking-query.service';
import { HotelBookingsService } from './hotel-bookings.service';
import type { HotelBookingDetails } from './booking-view';

@ApiTags('Hotel Bookings')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly bookings: HotelBookingsService,
    private readonly holds: HotelBookingHoldService,
    private readonly cancellations: HotelBookingCancellationService,
    private readonly queries: HotelBookingQueryService,
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

  @Get()
  @ApiOperation({
    summary: 'List my hotel reservations by group (HTL-20)',
    description:
      'Upcoming: Confirmed and not yet checked out, or Pending Payment with a running hold. Past: Completed, or Confirmed after check-out. Cancelled: Cancelled or Expired. Each item shows reference, hotel, rooms, dates, guests, total and status. 10 per page, with the size of every group in `counts`.',
  })
  @ApiOkResponse({ description: 'A page of reservation summaries and group counts' })
  @ApiBadRequestResponse({ description: 'Invalid group or page' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListHotelBookingsQueryDto,
  ): Promise<HotelBookingList> {
    return this.queries.listMine(user.sub, query.group, query.page);
  }

  @Get(':id/refund-preview')
  @ApiOperation({
    summary: 'Preview the refund for cancelling my reservation (HTL-21)',
    description:
      "Shows the refund the hotel's cancellation terms give today, on the full total. Nothing changes. Only Confirmed reservations before their check-in date can be cancelled.",
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ description: 'Refund percentage, amount and free-cancellation deadline' })
  @ApiBadRequestResponse({ description: 'Invalid booking id' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({ description: 'Not Confirmed, or check-in date reached' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  refundPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelRefundPreview> {
    return this.cancellations.previewRefund(user.sub, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get my hotel reservation details (HTL-20)',
    description:
      "Full details of one of your reservations: every room with its guests and price, the cancellation terms, refund fields and whether it can still be cancelled. Another user's reservation is reported as not found (ACC-11).",
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ description: 'The reservation in full' })
  @ApiBadRequestResponse({ description: 'Invalid booking id' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  details(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<HotelBookingDetails> {
    return this.queries.getMine(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel my reservation (HTL-21)',
    description:
      'Requires confirm=true after viewing the refund preview. Pass expectedRefundAmount to refuse the cancellation if the refund changed since it was shown. The whole reservation (all its rooms) becomes Cancelled, the rooms are released for those dates and a refund is requested for a positive amount (PAY-03). Partial cancellation is not supported.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ description: 'The cancelled booking and its refund' })
  @ApiBadRequestResponse({ description: 'Invalid id, or confirm is not true' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({
    description: 'Not Confirmed, check-in date reached, or the refund changed',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelHotelBookingDto,
  ): Promise<HotelCancellationResult> {
    return this.cancellations.cancel(user.sub, id, dto);
  }
}