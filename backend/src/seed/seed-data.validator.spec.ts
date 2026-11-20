import { join } from 'node:path';

import { deriveCurrencies, loadSeedData } from './seed-data.loader';
import type { SeedData } from './seed-data.types';
import { validateSeedData } from './seed-data.validator';

const REAL_DATA_DIR = join(__dirname, 'data');

// A small valid dataset; each test breaks one thing.
function validData(): SeedData {
  return {
    countries: [
      { line: 2, id: 'EG', name: 'Egypt', currency: 'EGP' },
      { line: 3, id: 'DE', name: 'Germany', currency: 'EUR' },
    ],
    cities: [
      { line: 2, id: 'cairo', name: 'Cairo', countryCode: 'EG' },
      { line: 3, id: 'frankfurt', name: 'Frankfurt', countryCode: 'DE' },
    ],
    airports: [
      {
        line: 2,
        id: 'CAI',
        name: 'Cairo International Airport',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ],
    attractions: [
      { line: 2, id: 'att-1', name: 'Giza Pyramids', cityId: 'cairo' },
    ],
    headerErrors: [],
  };
}

describe('validateSeedData', () => {
  it('accepts the committed reference data with zero errors', () => {
    expect(validateSeedData(loadSeedData(REAL_DATA_DIR))).toEqual([]);
  });

  it('accepts the small valid fixture', () => {
    expect(validateSeedData(validData())).toEqual([]);
  });

  it.each<[string, (data: SeedData) => void, RegExp]>([
    [
      'a duplicate country code',
      (data) =>
        data.countries.push({ line: 4, id: 'EG', name: 'Egypt 2', currency: 'EGP' }),
      /^countries\.csv line 4: duplicate id "EG"/,
    ],
    [
      'a city with an unknown country',
      (data) => {
        data.cities[1].countryCode = 'ZZ';
      },
      /^cities\.csv line 3: unknown country_code "ZZ"/,
    ],
    [
      'an airport with an unknown city',
      (data) => {
        data.airports[0].cityId = 'lodon';
      },
      /^airports\.csv line 2: unknown city_id "lodon"/,
    ],
    [
      "an airport whose country_code differs from its city's",
      (data) => {
        data.airports[0].countryCode = 'DE';
      },
      /^airports\.csv line 2: country_code "DE" does not match city "cairo"/,
    ],
    [
      'an invalid time zone',
      (data) => {
        data.airports[0].timeZone = 'Mars/Olympus';
      },
      /^airports\.csv line 2: invalid time_zone "Mars\/Olympus"/,
    ],
    [
      'a lowercase IATA code',
      (data) => {
        data.airports[0].id = 'cai';
      },
      /^airports\.csv line 2: invalid iata_code "cai"/,
    ],
    [
      'an empty name',
      (data) => {
        data.cities[0].name = '';
      },
      /^cities\.csv line 2: name is required/,
    ],
    [
      'an attraction with an unknown city',
      (data) => {
        data.attractions[0].cityId = 'atlantis';
      },
      /^attractions\.csv line 2: unknown city_id "atlantis"/,
    ],
  ])('reports %s with the file and line', (_label, breakData, expected) => {
    const data = validData();
    breakData(data);

    const errors = validateSeedData(data);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(expected);
  });

  it('returns every error, not just the first', () => {
    const data = validData();
    data.countries[0].currency = 'egp';
    data.airports[0].timeZone = 'Mars/Olympus';
    data.attractions[0].cityId = 'atlantis';

    const errors = validateSeedData(data);

    expect(errors).toHaveLength(3);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('countries.csv line 2'),
        expect.stringContaining('airports.csv line 2'),
        expect.stringContaining('attractions.csv line 2'),
      ]),
    );
  });

  it('includes header errors and flags empty files', () => {
    const data = validData();
    data.headerErrors.push('airports.csv: expected headers [...], got [...]');
    data.airports = [];

    const errors = validateSeedData(data);

    expect(errors).toContain('airports.csv: expected headers [...], got [...]');
    expect(errors).toContain('airports.csv: must contain at least one row');
  });
});

describe('deriveCurrencies', () => {
  it('derives the 7 supported currencies from the committed countries', () => {
    const currencies = deriveCurrencies(loadSeedData(REAL_DATA_DIR).countries);

    expect(currencies.map((c) => c.id)).toEqual([
      'AED',
      'EGP',
      'EUR',
      'GBP',
      'JPY',
      'SAR',
      'USD',
    ]);
    expect(currencies.find((c) => c.id === 'EUR')?.countryCodes).toEqual([
      'DE',
      'FR',
    ]);
  });
});
