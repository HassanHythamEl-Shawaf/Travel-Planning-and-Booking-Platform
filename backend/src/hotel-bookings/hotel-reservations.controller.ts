import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ProviderOwnership } from '../auth/decorators/provider-ownership.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ProviderOwnershipGuard } from '../auth/guards/provider-ownership.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { ListHotelReservationsQueryDto } from './dto/list-hotel-reservations.dto';
import { HotelBookingQueryService } from './hotel-booking-query.service';

@ApiTags('Hotels')
@Controller('hotels')
@UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
@Roles(UserRole.MODERATOR, UserRole.ADMIN)
@ProviderOwnership('hotel', 'hotelId')
@ApiCookieAuth('access_token')
export class HotelReservationsController {
  constructor(private readonly bookings: HotelBookingQueryService) {}

  @Get(':hotelId/reservations')
  @ApiOperation({ summary: 'List reservations for an assigned hotel (HTL-22)' })
  @ApiParam({ name: 'hotelId', description: 'Assigned hotel ID' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ['Pending Payment', 'Confirmed', 'Completed', 'Expired', 'Cancelled'] })
  @ApiQuery({ name: 'from', required: false, type: String, example: '2026-11-20' })
  @ApiQuery({ name: 'to', required: false, type: String, example: '2026-12-20' })
  @ApiOkResponse({ description: 'Paginated reservations with guest, date, and status details' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator or administrator required' })
  list(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Query() query: ListHotelReservationsQueryDto,
  ) {
    return this.bookings.listForHotel(hotelId, query);
  }
}
