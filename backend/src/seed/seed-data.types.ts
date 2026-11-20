// Typed rows produced by the CSV loader (GEN-12). `line` is the source line
// in the CSV file (header = line 1) so validation errors can point to it.

export interface CountryRow {
  line: number;
  id: string;
  name: string;
  currency: string;
}

export interface CityRow {
  line: number;
  id: string;
  name: string;
  countryCode: string;
}

export interface AirportRow {
  line: number;
  id: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}

export interface AttractionRow {
  line: number;
  id: string;
  name: string;
  cityId: string;
}

export interface CurrencyRow {
  id: string;
  countryCodes: string[];
}

export interface SeedData {
  countries: CountryRow[];
  cities: CityRow[];
  airports: AirportRow[];
  attractions: AttractionRow[];
  headerErrors: string[];
}
