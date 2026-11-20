import { ConfigService } from '@nestjs/config';

import { FxApiError, HttpFxRatesClient, parseLatest } from './fx-rates.client';

/** The provider's documented /latest response. */
const latest = {
  success: true,
  terms: 'https://fxratesapi.com/legal/terms-conditions',
  privacy: 'https://fxratesapi.com/legal/privacy-policy',
  timestamp: 1794836400,
  date: '2026-11-16T12:00:00.000Z',
  base: 'USD',
  rates: { EGP: 48.5, EUR: 0.92, USD: 1, XAU: 0.0004, bad: 3, ZZZ: -1 },
};

describe('parseLatest (ITN-18)', () => {
  it('keeps the base, the rate date and the valid rates', () => {
    expect(parseLatest(latest)).toEqual({
      base: 'USD',
      rateDate: '2026-11-16',
      rates: { EGP: 48.5, EUR: 0.92, USD: 1, XAU: 0.0004 },
    });
  });

  it('rejects error bodies and unexpected shapes', () => {
    expect(() =>
      parseLatest({ success: false, error: 'invalid_key', description: 'x' }),
    ).toThrow(FxApiError);
    expect(() => parseLatest(null)).toThrow(FxApiError);
    expect(() => parseLatest({ ...latest, rates: undefined })).toThrow(
      FxApiError,
    );
    expect(() => parseLatest({ ...latest, date: 'yesterday' })).toThrow(
      FxApiError,
    );
    expect(() => parseLatest({ ...latest, rates: { bad: 1 } })).toThrow(
      FxApiError,
    );
  });
});

describe('HttpFxRatesClient (ITN-18)', () => {
  const KEY = 'test-key-not-real';
  const client = (key?: string) =>
    new HttpFxRatesClient({ get: () => key } as unknown as ConfigService);
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  it('sends the key as a Bearer header, never in the URL', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(latest), { status: 200 }),
    );
    await client(KEY).fetchLatest();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.fxratesapi.com/latest');
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(init.signal).toBeDefined();
  });

  it('works without a key (no Authorization header)', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(latest), { status: 200 }),
    );
    await client(undefined).fetchLatest();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('turns HTTP errors, timeouts, network errors and bad JSON into FxApiError without the key', async () => {
    const failures: (() => void)[] = [
      () => fetchMock.mockResolvedValue(new Response('{}', { status: 401 })),
      () =>
        fetchMock.mockRejectedValue(
          Object.assign(new Error(`timeout ${KEY}`), { name: 'TimeoutError' }),
        ),
      () => fetchMock.mockRejectedValue(new TypeError(`fetch failed ${KEY}`)),
      () =>
        fetchMock.mockResolvedValue(new Response('not json', { status: 200 })),
    ];
    for (const fail of failures) {
      fail();
      const error = await client(KEY)
        .fetchLatest()
        .catch((e: Error) => e);
      expect(error).toBeInstanceOf(FxApiError);
      expect((error as Error).message).not.toContain(KEY);
    }
  });
});
