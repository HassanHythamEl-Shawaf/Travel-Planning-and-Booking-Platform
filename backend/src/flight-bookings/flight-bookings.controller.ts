import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
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
  ApiProduces,
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
  CancelFlightBookingDto,
  FlightCancellationResultDto,
  FlightRefundPreviewDto,
} from './dto/cancel-flight-booking.dto';
import {
  FlightBookingDetailsDto,
  FlightBookingListResponseDto,
  ListFlightBookingsQueryDto,
} from './dto/list-flight-bookings.dto';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingsService } from './flight-bookings.service';

@ApiTags('Flight Bookings')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly bookings: FlightBookingsService,
    private readonly cancellations: FlightBookingCancellationService,
  ) {}

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

  @Get(':id/refund-preview')
  @ApiOperation({
    summary: 'Preview the refund for cancelling my booking (FLT-26)',
    description:
      "Shows the refund the airline's cancellation tiers give today, on the full total and based on the outbound departure. Nothing changes. Only Confirmed bookings before departure can be cancelled.",
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ type: FlightRefundPreviewDto })
  @ApiBadRequestResponse({ description: 'Invalid booking id' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({ description: 'Not Confirmed, or already departed' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  refundPreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<FlightRefundPreviewDto> {
    return this.cancellations.previewRefund(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel my booking (FLT-26)',
    description:
      'Requires confirm=true after viewing the refund preview. Pass expectedRefundAmount to refuse the cancellation if the refund changed since it was shown. The whole booking (both flights of a round trip) becomes Cancelled, its seats return to inventory and a refund is requested for a positive amount (PAY-03).',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({ type: FlightCancellationResultDto })
  @ApiBadRequestResponse({ description: 'Invalid id, or confirm is not true' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({
    description: 'Not Confirmed, already departed, or the refund changed',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CancelFlightBookingDto,
  ): Promise<FlightCancellationResultDto> {
    return this.cancellations.cancel(user.sub, id, dto);
  }

  @Get(':id/e-ticket')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Download my e-ticket as a PDF (FLT-23)',
    description:
      'Available once the booking is Confirmed (also after the trip, when Completed). Shows the booking reference, flights in local airport times, cabin and baggage, passengers and the amount paid.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60740' })
  @ApiOkResponse({
    description: 'The e-ticket PDF, as a file download',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiBadRequestResponse({ description: 'Invalid booking id' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({ description: 'The booking is not confirmed' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  async eTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<StreamableFile> {
    const { filename, pdf } = await this.bookings.getETicket(user.sub, id);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: pdf.length,
    });
  }
}
