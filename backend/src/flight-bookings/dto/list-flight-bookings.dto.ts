import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

import { CabinCategory } from '../../airlines/schemas/flight.schema';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { BOOKING_STATUS } from '../../integrations/teammate-contracts';
import {
  CancellationSource,
  PassengerType,
  SegmentDirection,
  TripType,
} from '../flight-booking.constants';
import type { FlightBookingStatus } from '../flight-booking-status';
import { FlightBookingResponseDto } from './flight-booking-response.dto';

/** FLT-25 tabs. Every booking belongs to exactly one group. */
export enum FlightBookingGroup {
  /** Confirmed and not yet departed, or Pending Payment with a running hold. */
  UPCOMING = 'upcoming',
  /** Completed, or Confirmed whose outbound flight has departed. */
  PAST = 'past',
  /** Cancelled or Expired (including holds that ran out but are not yet processed). */
  CANCELLED = 'cancelled',
}

export class ListFlightBookingsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: FlightBookingGroup,
    default: FlightBookingGroup.UPCOMING,
  })
  @IsOptional()
  @IsEnum(FlightBookingGroup)
  group?: FlightBookingGroup = FlightBookingGroup.UPCOMING;
}

export class FlightBookingListSegmentDto {
  @ApiProperty({ enum: SegmentDirection, example: SegmentDirection.OUTBOUND })
  direction: SegmentDirection;

  @ApiProperty({ example: 'NA101' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportCode: string;

  @ApiProperty({ example: 'LHR' })
  arrivalAirportCode: string;

  @ApiProperty({ example: '2026-12-01T06:00:00.000Z', description: 'UTC' })
  departureAt: Date;

  @ApiProperty({
    example: '2026-12-01T08:00:00+02:00',
    description: 'Departure airport local time (GEN-06)',
  })
  departureLocalTime: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabinCategory: CabinCategory;
}

export class FlightBookingListPassengerDto {
  @ApiProperty({ example: 'Sara Hassan' })
  fullName: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  type: PassengerType;
}

/** FLT-25 row: reference, flight, date, passengers, cabin and status. */
export class FlightBookingListItemDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60740' })
  id: string;

  @ApiProperty({ example: 'K7QM2X', nullable: true, type: String })
  bookingReference: string | null;

  @ApiProperty({
    enum: Object.values(BOOKING_STATUS),
    example: BOOKING_STATUS.CONFIRMED,
  })
  status: FlightBookingStatus;

  @ApiProperty({ enum: TripType, example: TripType.ONE_WAY })
  tripType: TripType;

  @ApiProperty({ type: [FlightBookingListSegmentDto] })
  segments: FlightBookingListSegmentDto[];

  @ApiProperty({ type: [FlightBookingListPassengerDto] })
  passengers: FlightBookingListPassengerDto[];

  @ApiProperty({ example: 250 })
  totalPrice: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: null,
    nullable: true,
    type: Date,
    description: 'Set while the booking is Pending Payment',
  })
  holdExpiresAt: Date | null;

  @ApiProperty({ example: '2026-11-10T18:00:00.000Z' })
  createdAt: Date;
}

export class FlightBookingGroupCountsDto {
  @ApiProperty({ example: 2 })
  upcoming: number;

  @ApiProperty({ example: 5 })
  past: number;

  @ApiProperty({ example: 1 })
  cancelled: number;
}

export class FlightBookingListResponseDto extends PaginatedResponseDto {
  @ApiProperty({
    enum: FlightBookingGroup,
    example: FlightBookingGroup.UPCOMING,
  })
  group: FlightBookingGroup;

  @ApiProperty({ type: [FlightBookingListItemDto] })
  items: FlightBookingListItemDto[];

  @ApiProperty({
    type: FlightBookingGroupCountsDto,
    description: 'Bookings in each group, for the tab badges',
  })
  counts: FlightBookingGroupCountsDto;
}

/** FLT-25 full details, owner only. */
export class FlightBookingDetailsDto extends FlightBookingResponseDto {
  @ApiProperty({ type: Date, nullable: true, example: null })
  confirmedAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, example: null })
  expiredAt: Date | null;

  @ApiProperty({ type: Date, nullable: true, example: null })
  cancelledAt: Date | null;

  @ApiProperty({
    enum: CancellationSource,
    nullable: true,
    example: null,
    description: 'user (FLT-26) or flight-cancelled (FLT-06)',
  })
  cancellationSource: CancellationSource | null;

  @ApiProperty({ type: Date, nullable: true, example: null })
  completedAt: Date | null;
}
