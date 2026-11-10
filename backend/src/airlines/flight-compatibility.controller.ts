import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
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
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { AirportResponseDto } from './dto/airport.dto';
import {
  CancelFlightDto,
  FlightCancellationResponseDto,
} from './dto/flight-cancellation.dto';
import { FlightDetailsResponseDto } from './dto/flight-details.dto';
import { FlightBookingsResponseDto } from './dto/flight-booking.dto';
import { CreateFlightDto, FlightResponseDto } from './dto/flight.dto';
import { FlightSearchResponseDto, SearchFlightsDto } from './dto/flight-search.dto';
import { FlightStatusResponseDto } from './dto/flight-status.dto';
import {
  FlightUpdateResponseDto,
  UpdateFlightScheduleDto,
} from './dto/flight-update.dto';
import { AirlinesService } from './airlines.service';

const ID_PARAM = {
  name: 'id',
  example: '6650f1c2a1b2c3d4e5f60719',
} as const;

@ApiTags('Flights')
@Controller()
export class FlightCompatibilityController {
  constructor(private readonly airlines: AirlinesService) {}

  @Get('airports')
  @ApiOperation({ summary: 'List seeded airports (FLT-02)' })
  @ApiOkResponse({ type: [AirportResponseDto] })
  listAirports(): Promise<AirportResponseDto[]> {
    return this.airlines.listAirports();
  }

  @Post('flights')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Create a flight (FLT-03)' })
  @ApiCreatedResponse({ type: FlightResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight input' })
  @ApiConflictResponse({ description: 'Invalid schedule or duplicate flight' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  createFlight(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFlightDto,
  ): Promise<FlightResponseDto> {
    return this.airlines.createFlight(user.sub, dto);
  }

  @Get('flights/search')
  @ApiOperation({ summary: 'Search scheduled flights (FLT-11)' })
  @ApiOkResponse({ type: FlightSearchResponseDto })
  searchFlights(
    @Query() dto: SearchFlightsDto,
  ): Promise<FlightSearchResponseDto> {
    return this.airlines.searchFlights(dto);
  }

  @Get('flights/:id/status')
  @ApiOperation({ summary: 'Get the current flight status (FLT-30)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: FlightStatusResponseDto })
  getFlightStatus(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightStatusResponseDto> {
    return this.airlines.getFlightStatus(id);
  }

  @Get('flights/:id')
  @ApiOperation({ summary: 'Get flight details (FLT-17)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: FlightDetailsResponseDto })
  getFlightDetails(
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightDetailsResponseDto> {
    return this.airlines.getFlightDetails(id);
  }

  @Patch('flights/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Update a scheduled flight (FLT-05)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: FlightUpdateResponseDto })
  updateFlightSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateFlightScheduleDto,
  ): Promise<FlightUpdateResponseDto> {
    return this.airlines.updateFlightSchedule(user.sub, id, dto);
  }

  @Post('flights/:id/cancel')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Cancel a scheduled flight (FLT-06)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: FlightCancellationResponseDto })
  cancelFlight(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelFlightDto,
  ): Promise<FlightCancellationResponseDto> {
    return this.airlines.cancelFlight(user.sub, id, dto.confirm);
  }

  @Get('flights/:id/bookings')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'List flight bookings (FLT-29)' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: FlightBookingsResponseDto })
  listFlightBookings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightBookingsResponseDto> {
    return this.airlines.listFlightBookings(user.sub, id);
  }

  @Get('flights/:id/passengers/export')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.MODERATOR)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Export flight passengers as CSV (FLT-29)' })
  @ApiParam(ID_PARAM)
  @ApiHeader({
    name: 'Content-Disposition',
    description: 'CSV attachment filename',
  })
  @ApiOkResponse({ description: 'CSV passenger booking export' })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="flight-passengers.csv"')
  exportFlightPassengers(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<string> {
    return this.airlines.exportFlightBookings(user.sub, id);
  }
}
