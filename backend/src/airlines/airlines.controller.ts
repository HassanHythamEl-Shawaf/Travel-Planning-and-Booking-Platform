import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
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

import { ProviderOwnership } from '../auth/decorators/provider-ownership.decorator';
import {
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ProviderOwnershipGuard } from '../auth/guards/provider-ownership.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import {
  AirlineResponseDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { AirlinesService } from './airlines.service';
import { AirportResponseDto } from './dto/airport.dto';
import {
  BaggagePolicyResponseDto,
  UpdateBaggagePolicyDto,
} from './dto/baggage-policy.dto';
import {
  CancellationPolicyResponseDto,
  UpdateCancellationPolicyDto,
} from './dto/cancellation-policy.dto';
import { CreateFlightDto, FlightResponseDto } from './dto/flight.dto';
import { FlightStatusResponseDto } from './dto/flight-status.dto';
import {
  FlightSearchResponseDto,
  SearchFlightsDto,
} from './dto/flight-search.dto';
import { FlightDetailsResponseDto } from './dto/flight-details.dto';

const ID_PARAM = {
  name: 'id',
  example: '6650f1c2a1b2c3d4e5f60718',
} as const;

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Get('airports')
  @ApiOperation({
    summary: 'List seeded airports (FLT-02)',
    description: 'Read-only airport reference data used by flight creation and search.',
  })
  @ApiOkResponse({ type: [AirportResponseDto] })
  listAirports(): Promise<AirportResponseDto[]> {
    return this.airlines.listAirports();
  }

  @Post('flights')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create a flight (FLT-03)',
    description:
      'Airline moderators may create flights only for their assigned airline. Input date-times are local to each seeded airport and are stored in UTC with both IANA zones.',
  })
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight input' })
  @ApiConflictResponse({
    description: 'Invalid schedule, past departure or duplicate flight',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  createFlight(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFlightDto,
  ): Promise<FlightResponseDto> {
    return this.airlines.createFlight(user.sub, dto);
  }

  @Get('flights/:id/status')
  @ApiOperation({
    summary: 'Get the current flight status (FLT-30)',
    description:
      'Status is derived from persisted cancellation state and the departure time. A scheduler can call the same service method without a cron job in this module.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60719' })
  @ApiOkResponse({ type: FlightStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight id' })
  @ApiNotFoundResponse({ description: 'Flight not found' })
  getFlightStatus(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightStatusResponseDto> {
    return this.airlines.getFlightStatus(id);
  }

  @Get('flights/search')
  @ApiOperation({
    summary: 'Search scheduled flights (FLT-11)',
    description:
      'Searches active airlines by seeded airports, local departure date and minimum passenger capacity.',
  })
  @ApiOkResponse({ type: FlightSearchResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid search criteria' })
  @ApiNotFoundResponse({ description: 'Airport is not a seeded airport' })
  searchFlights(
    @Query() dto: SearchFlightsDto,
  ): Promise<FlightSearchResponseDto> {
    return this.airlines.searchFlights(dto);
  }

  @Get('flights/:id')
  @ApiOperation({
    summary: 'Get flight details (FLT-17)',
    description:
      'Returns airport-local schedule times, duration, current status, cabin availability and the airline cancellation policy.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60719' })
  @ApiOkResponse({ type: FlightDetailsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight id' })
  @ApiNotFoundResponse({ description: 'Flight or airline not found' })
  getFlightDetails(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightDetailsResponseDto> {
    return this.airlines.getFlightDetails(id);
  }

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create an airline profile (FLT-01)',
    description:
      'Administrator-only. New airlines are active by default. Airline logos are handled by Person 8 image-upload integration.',
  })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline name, code or logo input' })
  @ApiConflictResponse({ description: 'Airline code already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  create(@Body() dto: CreateAirlineDto): Promise<AirlineResponseDto> {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an airline profile (FLT-01)',
    description: 'Public airline profile. The isActive flag is included for administration and search integration.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline id' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<AirlineResponseDto> {
    return this.airlines.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('airline')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit the assigned airline profile (FLT-01)',
    description:
      'Only an airline moderator assigned to this airline may edit its name, code or logo. Administrators use the separate provider deactivation endpoint.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline id or body' })
  @ApiConflictResponse({ description: 'Duplicate airline code or empty update' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
  ): Promise<AirlineResponseDto> {
    return this.airlines.update(id, dto);
  }

  @Put(':id/baggage-policy')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('airline')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Update airline extra-baggage policy (FLT-08)',
    description:
      'The assigned airline moderator sets the extra-bag price and maximum bags per passenger. Extra bags use the selected cabin max-weight rule.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: BaggagePolicyResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid baggage policy or airline id' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned airline moderator required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  updateBaggagePolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateBaggagePolicyDto,
  ): Promise<BaggagePolicyResponseDto> {
    return this.airlines.updateBaggagePolicy(id, dto);
  }

  @Put(':id/cancellation-policy')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('airline')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Update airline cancellation policy (FLT-09)',
    description:
      'Unique days-before-departure tiers are stored in descending threshold order. Refund selection uses the highest threshold not exceeding days remaining.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: CancellationPolicyResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid or duplicate cancellation tiers' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned airline moderator required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  updateCancellationPolicy(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCancellationPolicyDto,
  ): Promise<CancellationPolicyResponseDto> {
    return this.airlines.updateCancellationPolicy(id, dto);
  }
}
