import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FX_API_BASE_URL, FX_API_TIMEOUT_MS } from './fx-rates.constants';

/** One snapshot of rates: 1 unit of `base` = rates[code] units of `code`. */
export interface FxSnapshot {
  base: string;
  /** The provider's rate date, YYYY-MM-DD. */
  rateDate: string;
  rates: Record<string, number>;
}

/** The only thing the rest of the app needs from the provider. */
export interface FxRatesClient {
  fetchLatest(): Promise<FxSnapshot>;
}

/** Thrown for any failure: network, timeout, HTTP error or unexpected body. */
export class FxApiError extends Error {}

/**
 * Calls FXRatesAPI `GET /latest` (server-side only, ITN-18). The response
 * looks like { success, timestamp, date, base, rates: { EGP: 48.9, ... } }.
 * It is checked before use, so a changed or broken response becomes an
 * FxApiError instead of wrong numbers. The API key is never logged or put
 * in the URL or in error messages.
 */
@Injectable()
export class HttpFxRatesClient implements FxRatesClient {
  constructor(private readonly config: ConfigService) {}

  async fetchLatest(): Promise<FxSnapshot> {
    const key = this.config.get<string>('FXRATES_API_KEY');
    let response: Response;
    try {
      response = await fetch(`${FX_API_BASE_URL}/latest`, {
        headers: {
          Accept: 'application/json',
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        signal: AbortSignal.timeout(FX_API_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new FxApiError(
        timedOut ? 'FX API timed out' : 'FX API unreachable',
      );
    }
    if (!response.ok) {
      throw new FxApiError(`FX API answered HTTP ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new FxApiError('FX API sent invalid JSON');
    }
    return parseLatest(body);
  }
}

/** Checks the provider's response and keeps only valid rates. */
export function parseLatest(body: unknown): FxSnapshot {
  const data = body as {
    success?: unknown;
    base?: unknown;
    date?: unknown;
    rates?: unknown;
  };
  if (
    typeof data !== 'object' ||
    data === null ||
    data.success === false ||
    typeof data.base !== 'string' ||
    typeof data.date !== 'string' ||
    typeof data.rates !== 'object' ||
    data.rates === null
  ) {
    throw new FxApiError('FX API sent an unexpected response');
  }
  const rateDate = data.date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate)) {
    throw new FxApiError('FX API sent an unexpected date');
  }

  const rates: Record<string, number> = {};
  for (const [code, value] of Object.entries(
    data.rates as Record<string, unknown>,
  )) {
    if (
      /^[A-Z]{3}$/.test(code) &&
      typeof value === 'number' &&
      value > 0 &&
      Number.isFinite(value)
    ) {
      rates[code] = value;
    }
  }
  rates[data.base] = 1;
  if (Object.keys(rates).length < 2) {
    throw new FxApiError('FX API sent no rates');
  }
  return { base: data.base, rateDate, rates };
}
