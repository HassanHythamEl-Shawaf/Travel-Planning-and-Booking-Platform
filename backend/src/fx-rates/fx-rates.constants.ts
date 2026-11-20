/** ITN-18 exchange rates. */

/** FXRatesAPI. The key (FXRATES_API_KEY) is sent as a Bearer header, never in the URL. */
export const FX_API_BASE_URL = 'https://api.fxratesapi.com';
export const FX_API_TIMEOUT_MS = 8000;

/** After a failed fetch, use cached rates and don't call the API again for this long. */
export const FX_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Display currency when the user has no preferred currency and none is
 * given in the request (guests too). Must be a supported currency.
 */
export const DEFAULT_DISPLAY_CURRENCY = 'USD';

/** Injection token for the HTTP client, so tests can replace it with a fake. */
export const FX_RATES_CLIENT = Symbol('FX_RATES_CLIENT');

export const FX_ERRORS = {
  unavailable:
    'Exchange rates are unavailable right now; please try again later',
  unsupported: (code: string) =>
    `Unsupported currency: ${code} (use a currency from GET /api/currencies)`,
  noRate: (code: string) => `No exchange rate is available for ${code}`,
} as const;
