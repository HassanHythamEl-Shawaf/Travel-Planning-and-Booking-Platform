import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse/sync';

import type {
  AirportRow,
  AttractionRow,
  CityRow,
  CountryRow,
  CurrencyRow,
  SeedData,
} from './seed-data.types';

export const SEED_FILES = {
  countries: 'countries.csv',
  cities: 'cities.csv',
  airports: 'airports.csv',
  attractions: 'attractions.csv',
} as const;

export const EXPECTED_HEADERS = {
  countries: ['code', 'name', 'currency'],
  cities: ['city_id', 'name', 'country_code'],
  airports: ['iata_code', 'name', 'city_id', 'country_code', 'time_zone'],
  attractions: ['attraction_id', 'name', 'city_id'],
} as const;

type SeedFileKey = keyof typeof SEED_FILES;
type RawRow = { line: number; values: Record<string, string> };

// The seed always runs from the backend/ folder (`npm run seed`), so the
// default data directory is resolved from the current working directory.
export const DEFAULT_SEED_DATA_DIR = join(process.cwd(), 'src', 'seed', 'data');

/**
 * Reads and parses the four reference CSVs. Bad data never throws: header
 * problems are returned in `headerErrors` and row problems are left for the
 * validator. Only a missing or unreadable file throws.
 */
export function loadSeedData(dir: string = DEFAULT_SEED_DATA_DIR): SeedData {
  const headerErrors: string[] = [];
  const read = (key: SeedFileKey) => readCsv(dir, key, headerErrors);

  const countries: CountryRow[] = read('countries').map(({ line, values }) => ({
    line,
    id: values.code,
    name: values.name,
    currency: values.currency,
  }));

  const cities: CityRow[] = read('cities').map(({ line, values }) => ({
    line,
    id: values.city_id,
    name: values.name,
    countryCode: values.country_code,
  }));

  const airports: AirportRow[] = read('airports').map(({ line, values }) => ({
    line,
    id: values.iata_code,
    name: values.name,
    cityId: values.city_id,
    countryCode: values.country_code,
    timeZone: values.time_zone,
  }));

  const attractions: AttractionRow[] = read('attractions').map(
    ({ line, values }) => ({
      line,
      id: values.attraction_id,
      name: values.name,
      cityId: values.city_id,
    }),
  );

  return { countries, cities, airports, attractions, headerErrors };
}

/** One entry per distinct currency code, country codes sorted, result sorted by id. */
export function deriveCurrencies(
  countries: Pick<CountryRow, 'id' | 'currency'>[],
): CurrencyRow[] {
  const byCurrency = new Map<string, Set<string>>();
  for (const country of countries) {
    const codes = byCurrency.get(country.currency) ?? new Set<string>();
    codes.add(country.id);
    byCurrency.set(country.currency, codes);
  }

  return [...byCurrency.entries()]
    .map(([id, codes]) => ({ id, countryCodes: [...codes].sort() }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function readCsv(
  dir: string,
  key: SeedFileKey,
  headerErrors: string[],
): RawRow[] {
  const file = SEED_FILES[key];
  const path = join(dir, file);

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read seed file ${path}: ${reason}`);
  }

  let headers: string[] = [];
  let records: { record: Record<string, string>; info: { lines: number } }[];
  try {
    records = parse(text, {
      // Same as `columns: true`, but also captures the header row for checking.
      columns: (header: string[]) => (headers = header),
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      info: true,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    headerErrors.push(`${file}: could not parse CSV: ${reason}`);
    return [];
  }

  const expected: readonly string[] = EXPECTED_HEADERS[key];
  const sameSet =
    headers.length === expected.length &&
    expected.every((name) => headers.includes(name));
  if (!sameSet) {
    headerErrors.push(
      `${file}: expected headers [${expected.join(', ')}], got [${headers.join(', ')}]`,
    );
    return [];
  }

  return records.map(({ record, info }) => ({
    line: info.lines,
    values: Object.fromEntries(
      expected.map((name) => [name, record[name] ?? '']),
    ),
  }));
}
