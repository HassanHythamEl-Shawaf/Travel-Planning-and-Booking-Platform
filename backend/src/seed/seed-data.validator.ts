import {
  COUNTRY_CODE_REGEX,
  CURRENCY_CODE_REGEX,
  IATA_CODE_REGEX,
} from '../reference-data/reference-data.constants';
import { SEED_FILES } from './seed-data.loader';
import type { SeedData } from './seed-data.types';

interface FieldSpec<T> {
  key: keyof T & string;
  header: string;
}

/**
 * Pure validation of loaded seed data. Returns every error found (an empty
 * array means the data is valid); it never stops at the first problem.
 */
export function validateSeedData(data: SeedData): string[] {
  const errors: string[] = [...data.headerErrors];

  const at = (file: string, line: number, message: string) =>
    errors.push(`${file} line ${line}: ${message}`);

  // Required fields + unique IDs, shared by every file. Returns the set of IDs.
  function checkCommon<T extends { line: number; id: string }>(
    file: string,
    rows: T[],
    fields: FieldSpec<T>[],
  ): Set<string> {
    if (rows.length === 0) {
      errors.push(`${file}: must contain at least one row`);
    }
    const ids = new Set<string>();
    for (const row of rows) {
      for (const { key, header } of fields) {
        if (!String(row[key] ?? '').trim()) {
          at(file, row.line, `${header} is required`);
        }
      }
      if (row.id) {
        if (ids.has(row.id)) at(file, row.line, `duplicate id "${row.id}"`);
        ids.add(row.id);
      }
    }
    return ids;
  }

  // countries
  const countriesFile = SEED_FILES.countries;
  const countryIds = checkCommon(countriesFile, data.countries, [
    { key: 'id', header: 'code' },
    { key: 'name', header: 'name' },
    { key: 'currency', header: 'currency' },
  ]);
  for (const country of data.countries) {
    if (country.id && !COUNTRY_CODE_REGEX.test(country.id)) {
      at(countriesFile, country.line, `invalid code "${country.id}" (expected 2 uppercase letters)`);
    }
    if (country.currency && !CURRENCY_CODE_REGEX.test(country.currency)) {
      at(countriesFile, country.line, `invalid currency "${country.currency}" (expected 3 uppercase letters)`);
    }
  }

  // cities
  const citiesFile = SEED_FILES.cities;
  const cityIds = checkCommon(citiesFile, data.cities, [
    { key: 'id', header: 'city_id' },
    { key: 'name', header: 'name' },
    { key: 'countryCode', header: 'country_code' },
  ]);
  const cityCountry = new Map<string, string>();
  for (const city of data.cities) {
    if (city.id && !cityCountry.has(city.id)) {
      cityCountry.set(city.id, city.countryCode);
    }
    if (city.countryCode && !countryIds.has(city.countryCode)) {
      at(citiesFile, city.line, `unknown country_code "${city.countryCode}"`);
    }
  }

  // airports
  const airportsFile = SEED_FILES.airports;
  checkCommon(airportsFile, data.airports, [
    { key: 'id', header: 'iata_code' },
    { key: 'name', header: 'name' },
    { key: 'cityId', header: 'city_id' },
    { key: 'countryCode', header: 'country_code' },
    { key: 'timeZone', header: 'time_zone' },
  ]);
  for (const airport of data.airports) {
    if (airport.id && !IATA_CODE_REGEX.test(airport.id)) {
      at(airportsFile, airport.line, `invalid iata_code "${airport.id}" (expected 3 uppercase letters)`);
    }
    if (airport.cityId && !cityIds.has(airport.cityId)) {
      at(airportsFile, airport.line, `unknown city_id "${airport.cityId}"`);
    }
    if (airport.countryCode) {
      if (!countryIds.has(airport.countryCode)) {
        at(airportsFile, airport.line, `unknown country_code "${airport.countryCode}"`);
      } else if (
        cityCountry.has(airport.cityId) &&
        cityCountry.get(airport.cityId) !== airport.countryCode
      ) {
        at(
          airportsFile,
          airport.line,
          `country_code "${airport.countryCode}" does not match city "${airport.cityId}" (country_code "${cityCountry.get(airport.cityId)}")`,
        );
      }
    }
    if (airport.timeZone && !isValidTimeZone(airport.timeZone)) {
      at(airportsFile, airport.line, `invalid time_zone "${airport.timeZone}"`);
    }
  }

  // attractions
  const attractionsFile = SEED_FILES.attractions;
  checkCommon(attractionsFile, data.attractions, [
    { key: 'id', header: 'attraction_id' },
    { key: 'name', header: 'name' },
    { key: 'cityId', header: 'city_id' },
  ]);
  for (const attraction of data.attractions) {
    if (attraction.cityId && !cityIds.has(attraction.cityId)) {
      at(attractionsFile, attraction.line, `unknown city_id "${attraction.cityId}"`);
    }
  }

  return errors;
}

// Intl.supportedValuesOf omits some valid aliases, so construct a formatter instead.
function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
