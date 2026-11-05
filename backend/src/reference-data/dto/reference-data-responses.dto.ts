import { ApiProperty } from '@nestjs/swagger';

export class CountryDto {
  @ApiProperty({ example: 'EG', description: 'ISO 3166-1 alpha-2 code' })
  id: string;

  @ApiProperty({ example: 'Egypt' })
  name: string;

  @ApiProperty({ example: 'EGP', description: 'ISO 4217 currency code' })
  currency: string;
}

export class CityDto {
  @ApiProperty({ example: 'cairo' })
  id: string;

  @ApiProperty({ example: 'Cairo' })
  name: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;
}

export class AirportDto {
  @ApiProperty({ example: 'CAI', description: 'IATA code' })
  id: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 'Africa/Cairo', description: 'IANA time zone' })
  timeZone: string;
}

export class AttractionDto {
  @ApiProperty({ example: 'att-1' })
  id: string;

  @ApiProperty({ example: 'Giza Pyramids and Sphinx' })
  name: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;
}

export class CurrencyDto {
  @ApiProperty({ example: 'EUR', description: 'ISO 4217 code' })
  id: string;

  @ApiProperty({ example: ['DE', 'FR'], type: [String] })
  countryCodes: string[];
}

// Map lean reference documents (string _id) to API response shapes (id).
export function toCountryDto(country: {
  _id: string;
  name: string;
  currency: string;
}): CountryDto {
  return { id: country._id, name: country.name, currency: country.currency };
}

export function toCityDto(city: {
  _id: string;
  name: string;
  countryCode: string;
}): CityDto {
  return { id: city._id, name: city.name, countryCode: city.countryCode };
}

export function toAirportDto(airport: {
  _id: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}): AirportDto {
  return {
    id: airport._id,
    name: airport.name,
    cityId: airport.cityId,
    countryCode: airport.countryCode,
    timeZone: airport.timeZone,
  };
}

export function toAttractionDto(attraction: {
  _id: string;
  name: string;
  cityId: string;
}): AttractionDto {
  return {
    id: attraction._id,
    name: attraction.name,
    cityId: attraction.cityId,
  };
}

export function toCurrencyDto(currency: {
  _id: string;
  countryCodes: string[];
}): CurrencyDto {
  return { id: currency._id, countryCodes: currency.countryCodes };
}
