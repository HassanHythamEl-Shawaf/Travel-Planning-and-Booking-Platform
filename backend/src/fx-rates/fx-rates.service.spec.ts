import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import {
  Currency,
  CurrencySchema,
} from '../reference-data/schemas/currency.schema';
import { User, UserRole, UserSchema } from '../users/schemas/user.schema';
import { FxApiError } from './fx-rates.client';
import { FX_RETRY_AFTER_MS } from './fx-rates.constants';
import { FxRatesService, makeConverter, todayUtc } from './fx-rates.service';
import {
  FxRateSnapshot,
  FxRateSnapshotSchema,
} from './schemas/fx-rate-snapshot.schema';

jest.setTimeout(120_000);

const fresh = {
  base: 'USD',
  rateDate: '2026-11-16',
  rates: { USD: 1, EGP: 50, EUR: 0.8 },
};

describe('makeConverter (ITN-18 maths)', () => {
  const converter = makeConverter(fresh, 'EUR', false);

  it('converts through the base: amount / rate[from] * rate[to]', () => {
    expect(converter.convert(100, 'USD')).toBe(80);
    expect(converter.convert(500, 'EGP')).toBe(8); // 500 / 50 * 0.8
    expect(converter.convert(12.34, 'EUR')).toBe(12.34);
  });

  it('sums several currencies and rounds once', () => {
    expect(
      converter.convertSum([
        { currency: 'EGP', amount: 1 },
        { currency: 'EGP', amount: 1 },
        { currency: 'USD', amount: 0.01 },
      ]),
    ).toBe(0.04); // 0.016 + 0.016 + 0.008 = 0.04
    expect(converter.convertSum([])).toBe(0);
  });

  it('gives a clear 503 for a currency without a rate', () => {
    expect(() => converter.convert(1, 'JOD')).toThrow(
      ServiceUnavailableException,
    );
    expect(() => converter.convert(1, 'JOD')).toThrow(
      'No exchange rate is available for JOD',
    );
    expect(() => makeConverter(fresh, 'JOD', false)).toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('FxRatesService (ITN-18) on MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let snapshots: Model<FxRateSnapshot>;
  let users: Model<User>;
  let client: { fetchLatest: jest.Mock };
  let service: FxRatesService;
  const userId = new Types.ObjectId();
  const viewer = { sub: userId.toString(), role: UserRole.USER };

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'fx' })
      .asPromise();
    snapshots = connection.model(
      FxRateSnapshot.name,
      FxRateSnapshotSchema,
    ) as unknown as Model<FxRateSnapshot>;
    await snapshots.syncIndexes();
    const currencies = connection.model(
      Currency.name,
      CurrencySchema,
    ) as unknown as Model<Currency>;
    await currencies.create(
      ['USD', 'EGP', 'EUR', 'JOD'].map((code) => ({
        _id: code,
        countryCodes: [],
      })),
    );
    users = connection.model(User.name, UserSchema) as unknown as Model<User>;
    await users.collection.insertOne({
      _id: userId,
      name: 'A',
      email: 'a@t.test',
    });
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  beforeEach(() => {
    client = { fetchLatest: jest.fn().mockResolvedValue(fresh) };
    service = new FxRatesService(
      snapshots,
      connection.model(Currency.name) as never,
      users,
      client,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await snapshots.deleteMany({});
  });

  it('fetches once per day and stores the snapshot', async () => {
    const first = await service.getRates();
    const second = await service.getRates();
    expect(client.fetchLatest).toHaveBeenCalledTimes(1);
    expect(first.usingCachedRates).toBe(false);
    expect(second.snapshot.rateDate).toBe('2026-11-16');
    const stored = await snapshots.find().lean();
    expect(stored).toHaveLength(1);
    expect(stored[0].day).toBe(todayUtc());
  });

  it('makes one API call for many parallel requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.getRates()),
    );
    expect(client.fetchLatest).toHaveBeenCalledTimes(1);
    expect(results.every((r) => r.snapshot.rates.EGP === 50)).toBe(true);
    expect(await snapshots.countDocuments()).toBe(1);
  });

  it('stores one snapshot even if another server saved first (unique day)', async () => {
    await snapshots.create({
      day: todayUtc(),
      ...fresh,
      rates: { USD: 1, EGP: 49 },
      fetchedAt: new Date(),
    });
    // This service missed it (e.g. it read just before), so it fetches too.
    jest.spyOn(snapshots, 'findOne').mockReturnValueOnce({
      lean: () => ({ exec: async () => null }),
    } as never);
    const { snapshot } = await service.getRates();
    expect(snapshot.rates.EGP).toBe(49);
    expect(await snapshots.countDocuments()).toBe(1);
  });

  it('uses the last cached rates when the API fails, and says so', async () => {
    await snapshots.create({
      day: '2026-11-10',
      ...fresh,
      rateDate: '2026-11-10',
      fetchedAt: new Date(),
    });
    client.fetchLatest.mockRejectedValue(new FxApiError('FX API timed out'));

    const result = await service.getRates();
    expect(result).toMatchObject({
      usingCachedRates: true,
      snapshot: { rateDate: '2026-11-10' },
    });

    // It waits before calling the API again.
    await service.getRates();
    expect(client.fetchLatest).toHaveBeenCalledTimes(1);
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + FX_RETRY_AFTER_MS + 1);
    client.fetchLatest.mockResolvedValue(fresh);
    expect((await service.getRates()).usingCachedRates).toBe(false);
  });

  it('answers 503 when the API fails and nothing is cached', async () => {
    client.fetchLatest.mockRejectedValue(new FxApiError('FX API unreachable'));
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  describe('display currency (ACC-09)', () => {
    it('uses the requested currency, else the preferred one, else USD', async () => {
      expect(await service.displayCurrency(viewer, 'EGP')).toBe('EGP');
      expect(await service.displayCurrency(viewer)).toBe('USD');
      expect(await service.displayCurrency(undefined)).toBe('USD');
      await users.updateOne(
        { _id: userId },
        { $set: { preferredCurrency: 'JOD' } },
      );
      expect(await service.displayCurrency(viewer)).toBe('JOD');
      // An unsupported preferred currency falls back to USD.
      await users.updateOne(
        { _id: userId },
        { $set: { preferredCurrency: 'XYZ' } },
      );
      expect(await service.displayCurrency(viewer)).toBe('USD');
    });

    it('rejects an unsupported requested currency with 400', async () => {
      await expect(
        service.displayCurrency(viewer, 'XYZ'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.fetchLatest).not.toHaveBeenCalled();
    });
  });
});
