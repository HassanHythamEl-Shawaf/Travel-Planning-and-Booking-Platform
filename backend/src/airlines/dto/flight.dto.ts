import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsISO8601, IsMongoId, IsString, Length, Matches } from 'class-validator';

const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateFlightDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  airlineId: string;

  @ApiProperty({ example: 'CA101', minLength: 2, maxLength: 10 })
  @Transform(trimUpper)
  @IsString()
  @Length(2, 10)
  @Matches(/^[A-Z0-9-]+$/)
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  @Transform(trimUpper)
  @IsString()
  @Length(3, 3)
  departureAirportCode: string;

  @ApiProperty({ example: 'DXB' })
  @Transform(trimUpper)
  @IsString()
  @Length(3, 3)
  arrivalAirportCode: string;

  @ApiProperty({
    example: '2026-12-01T10:30:00',
    description: 'Local date-time at the departure airport, without an offset',
  })
  @IsISO8601({ strict: true })
  departureLocalTime: string;

  @ApiProperty({
    example: '2026-12-01T14:00:00',
    description: 'Local date-time at the arrival airport, without an offset',
  })
  @IsISO8601({ strict: true })
  arrivalLocalTime: string;
}

export class FlightResponseDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60719' })
  id: string;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  airlineId: string;

  @ApiProperty({ example: 'CA101' })
  flightNumber: string;

  @ApiProperty({ example: 'CAI' })
  departureAirportCode: string;

  @ApiProperty({ example: 'DXB' })
  arrivalAirportCode: string;

  @ApiProperty({ example: '2026-12-01T08:30:00.000Z' })
  departureAt: Date;

  @ApiProperty({ example: '2026-12-01T10:00:00.000Z' })
  arrivalAt: Date;

  @ApiProperty({ example: 'Africa/Cairo' })
  departureTimeZone: string;

  @ApiProperty({ example: 'Asia/Dubai' })
  arrivalTimeZone: string;

  @ApiProperty({ example: '2026-12-01' })
  departureLocalDate: string;
}
