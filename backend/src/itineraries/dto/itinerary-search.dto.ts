import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { FlightSearchResponseDto } from '../../airlines/dto/flight-search.dto';
import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { DATE_ONLY_PATTERN } from '../itineraries.constants';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

const IATA = /^[A-Z]{3}$/;

// --------------------------------------------------------------- requests

/** ITN-25 */
export class ItineraryHotelQueryDto extends PageQueryDto {
  @ApiProperty({
    example: 1,
    description: 'Which city group (1 = the first one in cityGroups).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  group: number;

  @ApiProperty({ example: 3, description: 'Number of guests.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guests: number;

  @ApiProperty({ example: 2, description: 'Number of rooms.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rooms: number;
}

/** ITN-26 */
export class ItineraryFlightQueryDto extends PageQueryDto {
  @ApiProperty({ example: 'LHR', description: 'Origin airport (IATA).' })
  @Transform(upper)
  @Matches(IATA, { message: 'from must be a 3-letter airport code' })
  from: string;

  @ApiPropertyOptional({
    example: 'CAI',
    description:
      'Arrival airport in the city of day 1 (see /flights/airports). Optional if that city has one airport.',
  })
  @IsOptional()
  @Transform(upper)
  @Matches(IATA, { message: 'to must be a 3-letter airport code' })
  to?: string;

  @ApiPropertyOptional({ enum: ['one-way', 'round-trip'], default: 'one-way' })
  @IsOptional()
  @IsIn(['one-way', 'round-trip'])
  tripType?: 'one-way' | 'round-trip';

  @ApiPropertyOptional({
    example: '2026-12-20',
    description: "Default: the itinerary's start date.",
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'departureDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  departureDate?: string;

  @ApiPropertyOptional({
    example: '2026-12-29',
    description: "Round trips only. Default: the last day's date.",
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'returnDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  returnDate?: string;

  @ApiPropertyOptional({ example: 2, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  adults?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  children?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  infants?: number;

  @ApiPropertyOptional({ example: 'Economy' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  cabinClass?: string;

  @ApiPropertyOptional({ enum: ['price', 'duration', 'departure'] })
  @IsOptional()
  @IsIn(['price', 'duration', 'departure'])
  sort?: 'price' | 'duration' | 'departure';
}

// -------------------------------------------------------------- responses

export class HotelStayDto {
  @ApiProperty({ example: 1 })
  group: number;

  @ApiProperty({ example: 'luxor' })
  cityId: string;

  @ApiProperty({ example: 'Luxor' })
  cityName: string;

  @ApiProperty({
    example: '2026-12-22',
    description: "Date of the group's first day.",
  })
  checkIn: string;

  @ApiProperty({
    example: '2026-12-24',
    description: "The day after the group's last day.",
  })
  checkOut: string;

  @ApiProperty({ example: 2 })
  nights: number;

  @ApiProperty({ example: 3 })
  guests: number;

  @ApiProperty({ example: 2 })
  rooms: number;
}

export class ItineraryHotelRoomDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60721' })
  id: string;

  @ApiProperty({ example: 'Nile view double' })
  name: string;

  @ApiProperty({ example: 120 })
  pricePerNight: number;

  @ApiProperty({ example: 2 })
  maxAdults: number;

  @ApiProperty({ example: 1 })
  maxChildren: number;
}

export class ItineraryHotelDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '1 Corniche St' })
  address: string;

  @ApiProperty({ example: 'Luxor' })
  city: string;

  @ApiProperty({ example: 'Egypt' })
  country: string;

  @ApiProperty({ example: 4.5 })
  averageRating: number;

  @ApiProperty({ type: [String] })
  photos: string[];

  @ApiProperty({ example: 90, description: 'Cheapest free room per night.' })
  startingPrice: number;

  @ApiProperty({ example: 4 })
  availableRoomCount: number;

  @ApiProperty({
    type: [ItineraryHotelRoomDto],
    description: 'Rooms free for the whole stay.',
  })
  rooms: ItineraryHotelRoomDto[];
}

export class ItineraryHotelSearchDto extends PaginatedResponseDto {
  @ApiProperty({ type: HotelStayDto })
  stay: HotelStayDto;

  @ApiProperty({ type: [ItineraryHotelDto] })
  items: ItineraryHotelDto[];
}

export class AirportRefDto {
  @ApiProperty({ example: 'CAI' })
  code: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;
}

export class ArrivalAirportsDto {
  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'Cairo' })
  cityName: string;

  @ApiProperty({ type: [AirportRefDto] })
  airports: AirportRefDto[];
}

export class FlightSearchUsedDto {
  @ApiProperty({ example: 'LHR' })
  from: string;

  @ApiProperty({ example: 'CAI' })
  to: string;

  @ApiProperty({ enum: ['one-way', 'round-trip'] })
  tripType: string;

  @ApiProperty({ example: '2026-12-20' })
  departureDate: string;

  @ApiProperty({ example: '2026-12-29', nullable: true })
  returnDate: string | null;
}

/** Yahia's flight search response plus what was searched. */
export class ItineraryFlightSearchDto extends FlightSearchResponseDto {
  @ApiProperty({ type: FlightSearchUsedDto })
  search: FlightSearchUsedDto;

  @ApiProperty({ type: [AirportRefDto] })
  arrivalAirports: AirportRefDto[];
}
