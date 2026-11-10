import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsString,
  IsIn,
  IsOptional,
  Length,
  Max,
  Min,
} from 'class-validator';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class SearchFlightsDto {
  @ApiProperty({ example: 'CAI' })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  departureAirportCode: string;

  @ApiProperty({ example: 'DXB' })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  arrivalAirportCode: string;

  @ApiProperty({ example: '2026-12-01' })
  @IsDateString()
  departureDate: string;

  @ApiProperty({ example: '2026-12-08', required: false })
  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @ApiProperty({ enum: ['one-way', 'round-trip'], default: 'one-way' })
  @IsOptional()
  @IsIn(['one-way', 'round-trip'])
  tripType?: 'one-way' | 'round-trip';

  @ApiProperty({ example: 1, minimum: 0, maximum: 100, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  adults?: number;

  @ApiProperty({ example: 1, minimum: 0, maximum: 100, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  children?: number;

  @ApiProperty({ example: 0, minimum: 0, maximum: 100, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  infants?: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: 100, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  passengers?: number;

  @ApiProperty({ example: 'Economy', required: false })
  @IsOptional()
  @IsString()
  cabinClass?: string;
}

export class FlightSearchCabinDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({ example: 'Economy' })
  category: string;

  @ApiProperty({ example: 250 })
  price: number;

  @ApiProperty({ example: 25 })
  infantPrice: number;
  @ApiProperty({ example: 120 })
  seatsAvailable: number;

  @ApiProperty({ example: 1 })
  freeBaggageAllowance: number;

  @ApiProperty({ example: 23 })
  maxWeightPerBagKg: number;
}

export class FlightSearchResultDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60719' })
  id: string;

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

  @ApiProperty({ type: [FlightSearchCabinDto] })
  cabins: FlightSearchCabinDto[];
}

export class FlightSearchResponseDto {
  @ApiProperty({ type: [FlightSearchResultDto] })
  items: FlightSearchResultDto[];

  @ApiProperty({ example: 'No flights found' })
  message: string;

  @ApiProperty({ type: [FlightSearchResultDto], required: false })
  returnItems?: FlightSearchResultDto[];
}
