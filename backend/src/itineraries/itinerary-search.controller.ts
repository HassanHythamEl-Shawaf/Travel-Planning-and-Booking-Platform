import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import {
  ArrivalAirportsDto,
  ItineraryFlightQueryDto,
  ItineraryFlightSearchDto,
  ItineraryHotelQueryDto,
  ItineraryHotelSearchDto,
} from './dto/itinerary-search.dto';
import { ITINERARY_ID_PARAM } from './itineraries.controller';
import { NOT_OWNER } from './itineraries.service';
import { ItinerarySearchService } from './itinerary-search.service';

@ApiTags('Itinerary hotel and flight search')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({ description: NOT_OWNER })
@ApiNotFoundResponse({
  description: 'Itinerary not found, or not visible to you',
})
@UseGuards(AuthGuard)
@Controller('itineraries/:id')
export class ItinerarySearchController {
  constructor(private readonly search: ItinerarySearchService) {}

  @Get('hotels')
  @ApiOperation({
    summary: 'Hotels for a city group of my itinerary (ITN-25)',
    description:
      "Check-in = the group's first day, check-out = the day after its last day. Lists active hotels in that city with at least `rooms` rooms free for the whole stay whose combined maximum occupancy (adults + children) covers `guests`. Reuses the hotel search (HTL-11); 10 per page.",
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryHotelSearchDto })
  @ApiBadRequestResponse({
    description:
      'Invalid id or query, unknown group, more rooms than guests, or the group starts in the past',
  })
  hotels(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ItineraryHotelQueryDto,
  ) {
    return this.search.hotelsForGroup(id, user, query);
  }

  @Get('flights/airports')
  @ApiOperation({
    summary: 'Airports in the city of day 1 (ITN-26)',
    description:
      'The possible arrival airports for GET /itineraries/:id/flights.',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ArrivalAirportsDto })
  @ApiBadRequestResponse({
    description: 'Invalid id, or the itinerary has no days',
  })
  airports(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.search.arrivalAirports(id, user);
  }

  @Get('flights')
  @ApiOperation({
    summary: 'Flights to the city of day 1 (ITN-26)',
    description:
      "One-way or round-trip from `from` to an airport in the city of the first day. The outbound date defaults to the start date and the return date to the last day's date. `to` can be left out if that city has one airport. Reuses the flight search (FLT-11, FLT-12).",
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryFlightSearchDto })
  @ApiBadRequestResponse({
    description:
      'Invalid id or query, no days, no airport in that city, or `to` missing / not in that city',
  })
  @ApiConflictResponse({
    description:
      'Rejected by the flight search (e.g. return before departure, infants > adults)',
  })
  flights(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ItineraryFlightQueryDto,
  ) {
    return this.search.flights(id, user, query);
  }
}
