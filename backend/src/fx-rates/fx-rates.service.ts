import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Currency } from '../reference-data/schemas/currency.schema';
import { User } from '../users/schemas/user.schema';
import { FxApiError, type FxRatesClient } from './fx-rates.client';
import {
  DEFAULT_DISPLAY_CURRENCY,
  FX_ERRORS,
  FX_RATES_CLIENT,
  FX_RETRY_AFTER_MS,
} from './fx-rates.constants';
import { FxRateSnapshot } from './schemas/fx-rate-snapshot.schema';

/** Converts amounts into one display currency with one snapshot of rates. */
export interface Converter {
  /** The currency everything is converted to. */
  currency: string;
  /** The provider's date for the rates used. */
  rateDate: string;
  /** True if today's fetch failed and older cached rates were used. */
  usingCachedRates: boolean;
  /** One amount, rounded to 2 decimals. */
  convert(amount: number, from: string): number;
  /** The sum of amounts in several currencies, rounded once at the end. */
  convertSum(amounts: { currency: string; amount: number }[]): number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Today's date in UTC, YYYY-MM-DD. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Builds a converter from a snapshot. Rates are relative to the snapshot's
 * base, so any pair is a cross rate: amount / rate[from] * rate[to].
 * A currency missing from the snapshot gives a clear 503.
 */
export function makeConverter(
  snapshot: Pick<FxRateSnapshot, 'rates' | 'rateDate'>,
  currency: string,
  usingCachedRates: boolean,
): Converter {
  const rate = (code: string): number => {
    const value = snapshot.rates[code];
    if (!value) throw new ServiceUnavailableException(FX_ERRORS.noRate(code));
    return value;
  };
  const target = rate(currency);
  const raw = (amount: number, from: string) =>
    from === currency ? amount : (amount / rate(from)) * target;

  return {
    currency,
    rateDate: snapshot.rateDate,
    usingCachedRates,
    convert: (amount, from) => round2(raw(amount, from)),
    convertSum: (amounts) =>
      round2(amounts.reduce((sum, a) => sum + raw(a.amount, a.currency), 0)),
  };
}

/**
 * ITN-18: exchange rates from FXRatesAPI, fetched at most once per day and
 * cached in the database. If the API is down, the latest cached rates are
 * used (and the response says so); with no cache at all the answer is 503.
 * No cron job: the first request of the day fetches (spec D2).
 */
@Injectable()
export class FxRatesService {
  private readonly logger = new Logger(FxRatesService.name);
  /** The fetch in progress, so parallel requests share one API call. */
  private inFlight: Promise<FxRateSnapshot> | null = null;
  /** When the last fetch failed; we wait FX_RETRY_AFTER_MS before trying again. */
  private lastFailureAt = 0;

  constructor(
    @InjectModel(FxRateSnapshot.name)
    private readonly snapshots: Model<FxRateSnapshot>,
    @InjectModel(Currency.name) private readonly currencies: Model<Currency>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @Inject(FX_RATES_CLIENT) private readonly client: FxRatesClient,
  ) {}

  /** Today's rates, fetching them if this is the first need of the day. */
  async getRates(): Promise<{
    snapshot: FxRateSnapshot;
    usingCachedRates: boolean;
  }> {
    const today = todayUtc();
    const current = await this.snapshots
      .findOne({ day: today })
      .lean<FxRateSnapshot>()
      .exec();
    if (current) return { snapshot: current, usingCachedRates: false };

    if (Date.now() - this.lastFailureAt >= FX_RETRY_AFTER_MS) {
      try {
        return {
          snapshot: await this.fetchToday(today),
          usingCachedRates: false,
        };
      } catch (error) {
        if (!(error instanceof FxApiError)) throw error;
        this.lastFailureAt = Date.now();
        this.logger.warn(
          `Exchange rate fetch failed (${error.message}); using cached rates`,
        );
      }
    }

    const latest = await this.snapshots
      .findOne()
      .sort({ day: -1 })
      .lean<FxRateSnapshot>()
      .exec();
    if (!latest) throw new ServiceUnavailableException(FX_ERRORS.unavailable);
    return { snapshot: latest, usingCachedRates: true };
  }

  /**
   * A converter into `requested`, or else the user's preferred currency
   * (ACC-09), or else USD (spec D4). 400 for an unsupported currency.
   */
  async converter(
    viewer: AuthenticatedUser | undefined,
    requested?: string,
  ): Promise<Converter> {
    const currency = await this.displayCurrency(viewer, requested);
    const { snapshot, usingCachedRates } = await this.getRates();
    return makeConverter(snapshot, currency, usingCachedRates);
  }

  async displayCurrency(
    viewer: AuthenticatedUser | undefined,
    requested?: string,
  ): Promise<string> {
    if (requested) {
      if (!(await this.isSupported(requested))) {
        throw new BadRequestException(FX_ERRORS.unsupported(requested));
      }
      return requested;
    }
    if (viewer) {
      const user = await this.users
        .findById(viewer.sub, { preferredCurrency: 1 })
        .lean<{ preferredCurrency?: string }>()
        .exec();
      const preferred = user?.preferredCurrency;
      if (preferred && (await this.isSupported(preferred))) return preferred;
    }
    return DEFAULT_DISPLAY_CURRENCY;
  }

  private async isSupported(code: string): Promise<boolean> {
    return (await this.currencies.exists({ _id: code }).exec()) !== null;
  }

  /**
   * One API call at a time in this process. The unique `day` index covers
   * several processes: the loser of a race reads the winner's snapshot.
   */
  private fetchToday(today: string): Promise<FxRateSnapshot> {
    this.inFlight ??= (async () => {
      try {
        const fresh = await this.client.fetchLatest();
        const snapshot: FxRateSnapshot = {
          day: today,
          ...fresh,
          fetchedAt: new Date(),
        };
        try {
          await this.snapshots.create(snapshot);
        } catch (error) {
          if ((error as { code?: number }).code !== 11000) throw error;
          return (await this.snapshots
            .findOne({ day: today })
            .lean<FxRateSnapshot>()
            .exec())!;
        }
        return snapshot;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }
}
