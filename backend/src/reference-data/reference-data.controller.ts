import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { ListAttractionsQueryDto } from './dto/list-attractions-query.dto';
import { ListCitiesQueryDto } from './dto/list-cities-query.dto';
import { ListCountriesQueryDto } from './dto/list-countries-query.dto';
import { ListCurrenciesQueryDto } from './dto/list-currencies-query.dto';
import {
  PaginatedAttractionsDto,
  PaginatedCitiesDto,
  PaginatedCountriesDto,
  PaginatedCurrenciesDto,
} from './dto/paginated-response.dto';
import {
  toAttractionDto,
  toCityDto,
  toCountryDto,
  toCurrencyDto,
} from './dto/reference-data-responses.dto';
import { ReferenceDataService } from './reference-data.service';

const PAGE_QUERY = {
  name: 'page',
  required: false,
  type: Number,
  description: 'Page number (page size is fixed at 10)',
  example: 1,
} as const;

// Public, read-only: guests may read reference data, so there is no auth guard.
@ApiTags('Reference Data')
@Controller()
export class ReferenceDataController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Get('countries')
  @ApiOperation({
    summary: 'List countries (GEN-12)',
    description:
      'Seeded official countries, sorted by name. Supports case-insensitive search by name or code. Paginated, page size 10. Requirements: GEN-12, GEN-05, ITN-01.',
  })
  @ApiQuery(PAGE_QUERY)
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Case-insensitive match on country name or code',
    example: 'united',
  })
  @ApiOkResponse({ type: PaginatedCountriesDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async listCountries(
    @Query() query: ListCountriesQueryDto,
  ): Promise<PaginatedCountriesDto> {
    const result = await this.referenceDataService.listCountries(query);
    return { ...result, items: result.items.map(toCountryDto) };
  }

  @Get('cities')
  @ApiOperation({
    summary: 'List cities (GEN-12)',
    description:
      'Seeded official cities, sorted by name. Filter by country code and search by name. Paginated, page size 10. Requirements: GEN-12, GEN-05, ITN-05.',
  })
  @ApiQuery(PAGE_QUERY)
  @ApiQuery({
    name: 'countryCode',
    required: false,
    type: String,
    description: 'ISO 3166-1 alpha-2 country code (uppercase)',
    example: 'AE',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Case-insensitive match on city name',
    example: 'cai',
  })
  @ApiOkResponse({ type: PaginatedCitiesDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async listCities(
    @Query() query: ListCitiesQueryDto,
  ): Promise<PaginatedCitiesDto> {
    const result = await this.referenceDataService.listCities(query);
    return { ...result, items: result.items.map(toCityDto) };
  }

  @Get('attractions')
  @ApiOperation({
    summary: 'List attractions (GEN-12)',
    description:
      'Seeded official attractions, sorted by name. Filter by city ID. Paginated, page size 10. Requirements: GEN-12, GEN-05, ITN-10.',
  })
  @ApiQuery(PAGE_QUERY)
  @ApiQuery({
    name: 'cityId',
    required: false,
    type: String,
    description: 'Official city_id from the reference dataset',
    example: 'cairo',
  })
  @ApiOkResponse({ type: PaginatedAttractionsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async listAttractions(
    @Query() query: ListAttractionsQueryDto,
  ): Promise<PaginatedAttractionsDto> {
    const result = await this.referenceDataService.listAttractions(query);
    return { ...result, items: result.items.map(toAttractionDto) };
  }

  @Get('currencies')
  @ApiOperation({
    summary: 'List supported currencies (GEN-12)',
    description:
      'Supported currencies derived from the currency column of the official Countries dataset, sorted by code. Paginated, page size 10. Requirements: GEN-12, GEN-05, ITN-18, ACC-09.',
  })
  @ApiQuery(PAGE_QUERY)
  @ApiOkResponse({ type: PaginatedCurrenciesDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async listCurrencies(
    @Query() query: ListCurrenciesQueryDto,
  ): Promise<PaginatedCurrenciesDto> {
    const result = await this.referenceDataService.listCurrencies(query);
    return { ...result, items: result.items.map(toCurrencyDto) };
  }
}
