import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  OptionalAuthGuard,
  OptionalCurrentUser,
} from '../blog/optional-auth.guard';
import { PageQueryDto } from '../common/dto/page-query.dto';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import {
  ConfirmDto,
  CreateItineraryDto,
  CurrencyQueryDto,
  SearchItinerariesQueryDto,
  UpdateItineraryDto,
  VisibilityDto,
} from './dto/itinerary-requests.dto';
import {
  BudgetSummaryDto,
  ItineraryDeletedDto,
  ItineraryDetailDto,
  ItineraryListDto,
} from './dto/itinerary-responses.dto';
import type { BudgetSummary, ItineraryView } from './itinerary-view';
import {
  ItinerariesService,
  NOT_FOUND,
  NOT_OWNER,
} from './itineraries.service';
import { PublicItinerariesService } from './public-itineraries.service';

export const ITINERARY_ID_PARAM = {
  name: 'id',
  example: '6650f1c2a1b2c3d4e5f60718',
};
const NOT_VISIBLE = `${NOT_FOUND}, or not visible to you (private, hidden, or its owner is deactivated)`;

@ApiTags('Itineraries')
@Controller('itineraries')
export class ItinerariesController {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly publicItineraries: PublicItinerariesService,
  ) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create an itinerary (ITN-01)',
    description:
      'Title (max 100), one or more country codes and a start date. Private by default, no days yet.',
  })
  @ApiCreatedResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({
    description: 'Invalid body or unknown country code',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description: 'Only user accounts create itineraries',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateItineraryDto,
  ): Promise<ItineraryView> {
    return this.itineraries.create(user, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'List my itineraries (ITN-03)',
    description:
      'Title, countries, start date, number of days and visibility; most recently updated first; 10 per page. Hidden ones are included with isHidden: true.',
  })
  @ApiOkResponse({ type: ItineraryListDto })
  @ApiBadRequestResponse({ description: 'Invalid page' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PageQueryDto,
  ) {
    return this.itineraries.listMine(user, query.page);
  }

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Search public itineraries (ITN-21)',
    description:
      "For guests and users. q matches the title, a country (name or code) or a city name; filter by country, city and number of days. Private, hidden and deactivated users' itineraries are never listed. Newest first, 10 per page.",
  })
  @ApiOkResponse({ type: ItineraryListDto })
  @ApiBadRequestResponse({
    description: 'Invalid query (e.g. minDays > maxDays)',
  })
  search(@Query() query: SearchItinerariesQueryDto) {
    return this.publicItineraries.search(query);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'View an itinerary (ITN-03, ITN-21)',
    description:
      'Full details: days (numbered, dated), activities, budget entries, city groups, transport entries and budget totals. Public itineraries are visible to everyone, read-only (isOwner: false). Amounts are also converted (ITN-18) to `currency`, or your preferred currency, or USD; budget.conversion shows the currency and rate date. If no rates are available, conversion is null and conversionError says why.',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid id, or unsupported currency' })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @OptionalCurrentUser() viewer: AuthenticatedUser | undefined,
    @Query() query: CurrencyQueryDto,
  ): Promise<ItineraryView> {
    return this.itineraries.findOne(id, viewer, query.currency);
  }

  @Get(':id/budget')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Budget converted to one currency (ITN-14, ITN-18)',
    description:
      'Totals by category, by day and overall, in their original currencies and converted to `currency`, or your preferred currency (ACC-09), or USD. Rates come from FXRatesAPI, fetched once a day and cached; if the API is down the last cached rates are used (usingCachedRates: true). Booking prices are never converted (PAY-04).',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: BudgetSummaryDto })
  @ApiBadRequestResponse({ description: 'Invalid id, or unsupported currency' })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  @ApiServiceUnavailableResponse({
    description:
      'No exchange rates available (API down and nothing cached), or no rate for a currency used',
  })
  budget(
    @Param('id', ParseObjectIdPipe) id: string,
    @OptionalCurrentUser() viewer: AuthenticatedUser | undefined,
    @Query() query: CurrencyQueryDto,
  ): Promise<BudgetSummary> {
    return this.itineraries.budget(id, viewer, query.currency);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit title, countries or start date (ITN-01)',
    description: "Changing the start date moves every day's date with it.",
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({
    description: 'Invalid id or body, empty body, or unknown country',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: NOT_OWNER })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateItineraryDto,
  ): Promise<ItineraryView> {
    return this.itineraries.update(id, user, dto);
  }

  @Patch(':id/visibility')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Make an itinerary Public or Private (ITN-20)',
    description:
      'Public: in shared search, read-only for others. Private: removed from search immediately.',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: NOT_OWNER })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  setVisibility(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: VisibilityDto,
  ): Promise<ItineraryView> {
    return this.itineraries.setVisibility(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my itinerary (ITN-01)',
    description:
      'Body { "confirm": true } (GEN-03). Permanent: it leaves public search, open reports on it are closed, and its images are deleted. Clones made by other users are not affected.',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiOkResponse({ type: ItineraryDeletedDto })
  @ApiBadRequestResponse({ description: 'Invalid id, or confirm is not true' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: NOT_OWNER })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmDto,
  ): Promise<ItineraryDeletedDto> {
    return this.itineraries.remove(id, user, dto);
  }

  @Post(':id/clone')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Clone an itinerary into a private copy (ITN-21)',
    description:
      'Copies all days, activities (with their own copies of the images), budget and transport entries. The copy is private, credits the original author (clonedFrom) and is independent of the original.',
  })
  @ApiParam(ITINERARY_ID_PARAM)
  @ApiCreatedResponse({ type: ItineraryDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Only user accounts clone itineraries' })
  @ApiNotFoundResponse({ description: NOT_VISIBLE })
  clone(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.publicItineraries.clone(id, user);
  }
}
