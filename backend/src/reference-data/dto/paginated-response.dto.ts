import { ApiProperty } from '@nestjs/swagger';

import {
  AirportDto,
  AttractionDto,
  CityDto,
  CountryDto,
  CurrencyDto,
} from './reference-data-responses.dto';

// Swagger cannot describe generic classes, so each list gets a concrete
// response class sharing these pagination fields (GEN-05).
abstract class PaginatedResponseDto {
  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  limit: number;

  @ApiProperty({ example: 8 })
  total: number;

  @ApiProperty({ example: 1 })
  totalPages: number;
}

export class PaginatedCountriesDto extends PaginatedResponseDto {
  @ApiProperty({ type: [CountryDto] })
  items: CountryDto[];
}

export class PaginatedCitiesDto extends PaginatedResponseDto {
  @ApiProperty({ type: [CityDto] })
  items: CityDto[];
}

export class PaginatedAirportsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AirportDto] })
  items: AirportDto[];
}

export class PaginatedAttractionsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AttractionDto] })
  items: AttractionDto[];
}

export class PaginatedCurrenciesDto extends PaginatedResponseDto {
  @ApiProperty({ type: [CurrencyDto] })
  items: CurrencyDto[];
}
