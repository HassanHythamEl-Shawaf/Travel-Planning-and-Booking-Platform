import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { CabinCategory } from '../../airlines/schemas/flight.schema';
import {
  MAX_PASSENGERS_PER_BOOKING,
  PassengerType,
} from '../flight-booking.constants';

/** A flight from search (FLT-11) and the cabin chosen on it. */
export class FlightSelectionDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60719' })
  @IsMongoId()
  flightId: string;

  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  @IsEnum(CabinCategory)
  cabinCategory: CabinCategory;
}

/** FLT-19 passenger details. */
export class PassengerInputDto {
  @ApiProperty({ example: 'Sara Hassan', minLength: 1, maxLength: 100 })
  @IsString()
  @Length(1, 100)
  @Matches(/\S/, { message: 'fullName must not be blank' })
  fullName: string;

  @ApiProperty({
    example: '1995-04-02',
    description:
      'YYYY-MM-DD. Checked against the passenger type using the age on the outbound departure date.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be a date in YYYY-MM-DD format',
  })
  dateOfBirth: string;

  @ApiProperty({
    example: 'A12345678',
    description: 'Passport or national ID number (letters and digits).',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,30}$/, {
    message: 'documentNumber must be 3-30 letters or digits',
  })
  documentNumber: string;

  @ApiProperty({
    enum: PassengerType,
    example: PassengerType.ADULT,
    description: 'Adult 12+, Child 2-11, Infant under 2 (no seat, 10% fare).',
  })
  @IsEnum(PassengerType)
  type: PassengerType;

  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    description:
      "Extra bags on every flight of the trip, up to the airline's maximum (FLT-08).",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  extraBags?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 0,
    description:
      "Total weight of the extra bags in kg; at most extraBags x the cabin's maximum weight per bag.",
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  extraBaggageWeightKg?: number;
}

/**
 * Body of POST /api/flight-bookings (summary) and
 * POST /api/flight-bookings/hold. Sending returnFlight makes it a round
 * trip: one booking, two segments, one payment and one reference (FLT-12).
 */
export class CreateFlightBookingDto {
  @ApiProperty({ type: FlightSelectionDto })
  @ValidateNested()
  @Type(() => FlightSelectionDto)
  outbound: FlightSelectionDto;

  @ApiPropertyOptional({
    type: FlightSelectionDto,
    description: 'Only for a round trip: a flight on the reverse route.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlightSelectionDto)
  returnFlight?: FlightSelectionDto;

  @ApiProperty({ type: [PassengerInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PASSENGERS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => PassengerInputDto)
  passengers: PassengerInputDto[];
}
