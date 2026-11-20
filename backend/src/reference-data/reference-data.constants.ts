// Shared by the seed pipeline and ReferenceDataModule (GEN-12).
// Teammates rely on these collection names, so keep them stable.
export const REFERENCE_COLLECTIONS = {
  countries: 'countries',
  cities: 'cities',
  airports: 'airports',
  attractions: 'attractions',
  currencies: 'currencies',
} as const;

export const COUNTRY_CODE_REGEX = /^[A-Z]{2}$/;
export const CURRENCY_CODE_REGEX = /^[A-Z]{3}$/;
export const IATA_CODE_REGEX = /^[A-Z]{3}$/;

// Same rule as RegisterDto (ACC-01); re-declared because it is not exported there.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
