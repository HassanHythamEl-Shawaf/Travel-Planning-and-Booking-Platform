import { ApiProperty } from '@nestjs/swagger';

import { BOOKING_STATUS } from '../../integrations/teammate-contracts';
import { CabinCategory } from '../../airlines/schemas/flight.schema';
import {
  PassengerType,
  SegmentDirection,
  TripType,
} from '../flight-booking.constants';
import type { FlightBookingStatus } from '../flight-booking-status';

export class FlightSegmentResponseDto {
  @ApiProperty({ enum: SegmentDirection, example: SegmentDirection.OUTBOUND })
  direction: SegmentDirection;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60719' })
  flightId: string;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60701' })
  airlineId: string;

  @ApiProperty({ example: 'MS101' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportCode: string;

  @ApiProperty({ example: 'LHR' })
  arrivalAirportCode: string;

  @ApiProperty({ example: '2026-12-01T06:00:00.000Z', description: 'UTC' })
  departureAt: Date;

  @ApiProperty({ example: '2026-12-01T11:00:00.000Z', description: 'UTC' })
  arrivalAt: Date;

  @ApiProperty({
    example: '2026-12-01T08:00:00+02:00',
    description: 'Departure airport local time (GEN-06)',
  })
  departureLocalTime: string;

  @ApiProperty({
    example: '2026-12-01T11:00:00+00:00',
    description: 'Arrival airport local time (GEN-06)',
  })
  arrivalLocalTime: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  departureTimeZone: string;

  @ApiProperty({ example: 'Europe/London' })
  arrivalTimeZone: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  cabinCategory: CabinCategory;

  @ApiProperty({ example: 200, description: 'Fare per seat at booking time' })
  cabinFare: number;

  @ApiProperty({ example: 1, description: 'Free bags per passenger' })
  freeBaggageAllowance: number;

  @ApiProperty({ example: 23 })
  maxWeightPerBagKg: number;

  @ApiProperty({ example: 50 })
  pricePerExtraBag: number;

  @ApiProperty({ example: 2 })
  maxExtraBagsPerPassenger: number;

  @ApiProperty({ example: 2, description: 'Seats taken (adults + children)' })
  seats: number;
}

export class FlightPassengerResponseDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60730', required: false })
  id?: string;

  @ApiProperty({ example: 'Sara Hassan' })
  fullName: string;

  @ApiProperty({ example: '1995-04-02' })
  dateOfBirth: string;

  @ApiProperty({ example: 'A12345678' })
  documentNumber: string;

  @ApiProperty({ enum: PassengerType, example: PassengerType.ADULT })
  type: PassengerType;

  @ApiProperty({ example: 1 })
  extraBags: number;

  @ApiProperty({ example: 20 })
  extraBaggageWeightKg: number;

  @ApiProperty({ example: 200, description: 'Fare over all segments' })
  fare: number;

  @ApiProperty({
    example: 50,
    description: 'Extra-baggage fee over all segments',
  })
  baggageFee: number;
}

/** FLT-21 booking summary shown before payment. */
export class FlightBookingSummaryDto {
  @ApiProperty({ enum: TripType, example: TripType.ONE_WAY })
  tripType: TripType;

  @ApiProperty({ type: [FlightSegmentResponseDto] })
  segments: FlightSegmentResponseDto[];

  @ApiProperty({ type: [FlightPassengerResponseDto] })
  passengers: FlightPassengerResponseDto[];

  @ApiProperty({ example: 1, description: 'Seats per flight' })
  seats: number;

  @ApiProperty({ example: 200 })
  baseFare: number;

  @ApiProperty({ example: 50 })
  baggageFees: number;

  @ApiProperty({ example: 250 })
  totalPrice: number;

  @ApiProperty({ example: 'USD' })
  currency: string;
}

export class FlightBookingResponseDto extends FlightBookingSummaryDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60740' })
  id: string;

  @ApiProperty({
    enum: Object.values(BOOKING_STATUS),
    example: BOOKING_STATUS.PENDING_PAYMENT,
  })
  status: FlightBookingStatus;

  @ApiProperty({
    example: '2026-11-10T18:10:00.000Z',
    nullable: true,
    type: Date,
    description: 'Pay before this time or the hold expires (FLT-22)',
  })
  holdExpiresAt: Date | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'Issued at confirmation (FLT-23)',
  })
  bookingReference: string | null;

  @ApiProperty({ example: '2026-11-10T18:00:00.000Z' })
  createdAt: Date;
}
