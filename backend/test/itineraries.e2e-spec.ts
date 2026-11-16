/**
 * Itineraries e2e (ITN-01 to ITN-21, ITN-28, GEN-08, GEN-10, ACC-11, ACC-12). Boots
 * the whole AppModule over HTTP against an in-memory MongoDB replica set
 * and a temporary upload folder. Never Atlas, never real secrets.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { FxApiError } from '../src/fx-rates/fx-rates.client';
import { FX_RATES_CLIENT } from '../src/fx-rates/fx-rates.constants';
import { JPEG_BYTES } from './fixtures/images';

jest.setTimeout(240_000);

/** Fake FXRatesAPI: 1 USD = 40 EGP = 0.7 JOD. */
const FAKE_RATES = {
  base: 'USD',
  rateDate: '2026-11-16',
  rates: { USD: 1, EGP: 40, JOD: 0.7 },
};
const fakeFx = { fetchLatest: jest.fn().mockResolvedValue(FAKE_RATES) };

interface DayBody {
  id: string;
  dayNumber: number;
  date: string;
  cityId: string;
  activities: { id: string; images: { imageId: string; url: string }[] }[];
  budgetEntries: { id: string }[];
}

/** Reads a binary (PDF) response body into a Buffer. */
const binary = (
  res: NodeJS.ReadableStream,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Itineraries (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let uploadDir: string;
  let admin: TestAgent;
  let alice: TestAgent; // owner
  let bob: TestAgent;
  let aliceId: Types.ObjectId;

  let tripId: string; // Alice's main itinerary

  const PASSWORD = 'TravelPass123';
  const guest = () => request(server);

  const login = async (email: string, password = PASSWORD) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(201);
    return agent;
  };

  const register = async (name: string, email: string) => {
    await request(server)
      .post('/api/auth/register')
      .send({
        name,
        email,
        password: PASSWORD,
        termsAccepted: true,
        privacyPolicyAccepted: true,
      })
      .expect(201);
    return (await connection.collection('users').findOne({ email }))!
      ._id as Types.ObjectId;
  };

  const create = (agent: TestAgent, body: Record<string, unknown> = {}) =>
    agent.post('/api/itineraries').send({
      title: 'Ten days in Egypt',
      countries: ['EG'],
      startDate: '2026-12-30',
      ...body,
    });

  const days = (body: { days: DayBody[] }) =>
    body.days.map((d) => [d.dayNumber, d.date, d.cityId]);

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('itineraries-e2e');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';
    uploadDir = mkdtempSync(join(tmpdir(), 'itineraries-e2e-'));
    process.env.UPLOAD_DIR = uploadDir;

    const { AppModule } = await import('../src/app.module');
    // Never call the real exchange-rate API in tests (ITN-18).
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FX_RATES_CLIENT)
      .useValue(fakeFx)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    server = app.getHttpServer();
    connection = app.get<Connection>(getConnectionToken());
    expect(connection.host).toBe('127.0.0.1');
    await Promise.all(
      Object.values(connection.models).map((m) => m.syncIndexes()),
    );

    // Reference data (normally seeded from the official CSVs).
    await connection.collection('countries').insertMany([
      { _id: 'EG' as never, name: 'Egypt', currency: 'EGP' },
      { _id: 'JO' as never, name: 'Jordan', currency: 'JOD' },
    ]);
    await connection.collection('cities').insertMany([
      { _id: 'cairo' as never, name: 'Cairo', countryCode: 'EG' },
      { _id: 'luxor' as never, name: 'Luxor', countryCode: 'EG' },
      { _id: 'aswan' as never, name: 'Aswan', countryCode: 'EG' },
      { _id: 'amman' as never, name: 'Amman', countryCode: 'JO' },
    ]);
    await connection.collection('currencies').insertMany([
      { _id: 'EGP' as never, countryCodes: ['EG'] },
      { _id: 'USD' as never, countryCodes: ['US'] },
      { _id: 'JOD' as never, countryCodes: ['JO'] },
    ]);

    const now = new Date();
    await connection.collection('users').insertOne({
      name: 'E2E Admin',
      email: 'admin@itn.test',
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: 'admin',
      status: 'active',
      termsAcceptedAt: now,
      privacyPolicyAcceptedAt: now,
      failedLoginAttempts: 0,
      lockUntil: null,
      refreshTokenHash: null,
      lastActivityAt: null,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    });
    aliceId = await register('Alice Traveller', 'alice@itn.test');
    await register('Bob Reader', 'bob@itn.test');
    admin = await login('admin@itn.test');
    alice = await login('alice@itn.test');
    bob = await login('bob@itn.test');
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
    delete process.env.UPLOAD_DIR;
    rmSync(uploadDir, { recursive: true, force: true });
  });

  describe('create and days (ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09)', () => {
    it('creates a private itinerary for user accounts only', async () => {
      await create(guest() as never).expect(401);
      await create(admin).expect(403);
      await create(alice, { countries: ['XX'] }).expect(400);
      await create(alice, { title: 'x'.repeat(101) }).expect(400);
      await create(alice, { countries: [] }).expect(400);
      await create(alice, { startDate: '2026-02-30' }).expect(400);

      const res = await create(alice, { countries: ['EG', 'EG'] }).expect(201);
      tripId = res.body.id;
      expect(res.body).toMatchObject({
        title: 'Ten days in Egypt',
        countries: [{ code: 'EG', name: 'Egypt' }],
        startDate: '2026-12-30',
        dayCount: 0,
        isPublic: false,
        isOwner: true,
        author: { name: 'Alice Traveller' },
        clonedFrom: null,
      });
    });

    it('adds days numbered by position and dated from the start date', async () => {
      await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'cairo' })
        .expect(200);
      await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'cairo' })
        .expect(200);
      const res = await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'luxor', notes: 'Temples' })
        .expect(200);
      expect(days(res.body)).toEqual([
        [1, '2026-12-30', 'cairo'],
        [2, '2026-12-31', 'cairo'],
        [3, '2027-01-01', 'luxor'],
      ]);

      await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'atlantis' })
        .expect(400);
      await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'aswan', position: 9 })
        .expect(400);

      // Insert at the front: everything after it renumbers and re-dates.
      const front = await alice
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'aswan', position: 1 })
        .expect(200);
      expect(days(front.body)).toEqual([
        [1, '2026-12-30', 'aswan'],
        [2, '2026-12-31', 'cairo'],
        [3, '2027-01-01', 'cairo'],
        [4, '2027-01-02', 'luxor'],
      ]);
      // ITN-09: consecutive days in the same city are grouped.
      expect(
        front.body.cityGroups.map(
          (g: { cityName: string; dayCount: number }) => [
            g.cityName,
            g.dayCount,
          ],
        ),
      ).toEqual([
        ['Aswan', 1],
        ['Cairo', 2],
        ['Luxor', 1],
      ]);
    });

    it('lists my itineraries, most recently updated first (ITN-03)', async () => {
      const other = await create(alice, {
        title: 'Weekend in Amman',
        countries: ['JO'],
      }).expect(201);
      const list = await alice.get('/api/itineraries/mine').expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([
        other.body.id,
        tripId,
      ]);
      expect(list.body.items[1]).toMatchObject({
        dayCount: 4,
        isPublic: false,
      });

      await alice
        .patch(`/api/itineraries/${tripId}`)
        .send({ title: 'Egypt, updated' })
        .expect(200);
      const again = await alice.get('/api/itineraries/mine').expect(200);
      expect(again.body.items[0].id).toBe(tripId);
      await alice
        .delete(`/api/itineraries/${other.body.id}`)
        .send({ confirm: true })
        .expect(200);
    });

    it('moves every date when the start date changes', async () => {
      const res = await alice
        .patch(`/api/itineraries/${tripId}`)
        .send({ startDate: '2027-01-10' })
        .expect(200);
      expect(res.body.days.map((d: DayBody) => d.date)).toEqual([
        '2027-01-10',
        '2027-01-11',
        '2027-01-12',
        '2027-01-13',
      ]);
      await alice.patch(`/api/itineraries/${tripId}`).send({}).expect(400);
    });
  });

  describe('activities, budget and transport (ITN-10, ITN-14, ITN-16)', () => {
    let detail: {
      days: DayBody[];
      transportEntries: { id: string; dayNumber: number }[];
    };

    it('adds activities, budget entries and transport entries, and totals them', async () => {
      const start = (await alice.get(`/api/itineraries/${tripId}`).expect(200))
        .body;
      const [aswan, cairo1, , luxor] = start.days as DayBody[];
      const base = `/api/itineraries/${tripId}`;

      // Validation.
      await alice
        .post(`${base}/days/${cairo1.id}/activities`)
        .send({ name: 'Museum', cost: 10 })
        .expect(400);
      await alice
        .post(`${base}/days/${cairo1.id}/activities`)
        .send({ name: 'Museum', cost: 10, currency: 'XYZ' })
        .expect(400);
      await alice
        .post(`${base}/days/${cairo1.id}/budget-entries`)
        .send({ category: 'food', amount: -1, currency: 'EGP' })
        .expect(400);
      await alice
        .post(`${base}/days/${cairo1.id}/budget-entries`)
        .send({ category: 'souvenirs', amount: 1, currency: 'EGP' })
        .expect(400);

      await alice
        .post(`${base}/days/${cairo1.id}/activities`)
        .send({
          name: 'Egyptian Museum',
          time: '09:30',
          cost: 30,
          currency: 'USD',
        })
        .expect(200);
      await alice
        .post(`${base}/days/${cairo1.id}/budget-entries`)
        .send({ category: 'food', amount: 100.25, currency: 'EGP' })
        .expect(200);
      await alice
        .post(`${base}/days/${aswan.id}/budget-entries`)
        .send({ category: 'accommodation', amount: 80, currency: 'USD' })
        .expect(200);
      await alice
        .post(`${base}/transport-entries`)
        .send({
          dayId: luxor.id,
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'luxor',
          amount: 900,
          currency: 'EGP',
        })
        .expect(200);
      await alice
        .post(`${base}/transport-entries`)
        .send({
          dayId: new Types.ObjectId().toString(),
          mode: 'bus',
          fromCityId: 'luxor',
          toCityId: 'aswan',
          amount: 1,
          currency: 'EGP',
        })
        .expect(400);

      const res = await alice.get(base).expect(200);
      detail = res.body;
      expect(res.body.budget.byCategory).toMatchObject({
        food: { amounts: [{ currency: 'EGP', amount: 100.25 }] },
        accommodation: { amounts: [{ currency: 'USD', amount: 80 }] },
        in_city_transport: { amounts: [] },
        activities: { amounts: [{ currency: 'USD', amount: 30 }] },
        intercity_transport: { amounts: [{ currency: 'EGP', amount: 900 }] },
      });
      expect(res.body.budget.total.amounts).toEqual([
        { currency: 'EGP', amount: 1000.25 },
        { currency: 'USD', amount: 110 },
      ]);
      expect(res.body.transportEntries[0]).toMatchObject({
        dayNumber: 4,
        fromCityName: 'Cairo',
      });
    });

    it('edits and clears an activity cost', async () => {
      const day = detail.days[1];
      const activity = day.activities[0];
      const path = `/api/itineraries/${tripId}/days/${day.id}/activities/${activity.id}`;
      const res = await alice
        .patch(path)
        .send({ cost: null, time: null })
        .expect(200);
      expect(res.body.days[1].activities[0]).toMatchObject({
        cost: null,
        currency: null,
        time: null,
      });
      expect(res.body.budget.byCategory.activities.amounts).toEqual([]);
      await alice.patch(path).send({ cost: 30 }).expect(400); // no currency
      await alice.patch(path).send({ cost: 30, currency: 'USD' }).expect(200);
    });

    it('moves a day: numbers, dates and groups follow, transport stays on its day (ITN-08)', async () => {
      const luxor = detail.days[3];
      const res = await alice
        .patch(`/api/itineraries/${tripId}/days/${luxor.id}/position`)
        .send({ position: 1 })
        .expect(200);
      expect(days(res.body)).toEqual([
        [1, '2027-01-10', 'luxor'],
        [2, '2027-01-11', 'aswan'],
        [3, '2027-01-12', 'cairo'],
        [4, '2027-01-13', 'cairo'],
      ]);
      expect(res.body.transportEntries[0].dayNumber).toBe(1);
      expect(res.body.budget.byDay[0].total.amounts).toEqual([
        { currency: 'EGP', amount: 900 },
      ]);
      await alice
        .patch(`/api/itineraries/${tripId}/days/${luxor.id}/position`)
        .send({ position: 5 })
        .expect(400);
    });

    it('deletes a day after confirmation: renumbers, re-dates, recalculates (ITN-07)', async () => {
      const luxor = detail.days[3];
      const path = `/api/itineraries/${tripId}/days/${luxor.id}`;
      await alice.delete(path).expect(400);
      await alice.delete(path).send({ confirm: false }).expect(400);
      const res = await alice.delete(path).send({ confirm: true }).expect(200);
      expect(days(res.body)).toEqual([
        [1, '2027-01-10', 'aswan'],
        [2, '2027-01-11', 'cairo'],
        [3, '2027-01-12', 'cairo'],
      ]);
      // Its transport entry went with it.
      expect(res.body.transportEntries).toEqual([]);
      expect(res.body.budget.total.amounts).toEqual([
        { currency: 'EGP', amount: 100.25 },
        { currency: 'USD', amount: 110 },
      ]);
      await alice.delete(path).send({ confirm: true }).expect(404);
    });
  });

  describe('limits under parallel requests', () => {
    it('keeps every parallel day added, numbered 1..n without gaps', async () => {
      const trip = (await create(alice, { title: 'Parallel' }).expect(201)).body
        .id;
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          alice
            .post(`/api/itineraries/${trip}/days`)
            .send({ cityId: i % 2 ? 'cairo' : 'luxor', notes: `n${i}` }),
        ),
      );
      const ok = results.filter((r) => r.status === 200).length;
      expect(results.every((r) => r.status === 200 || r.status === 409)).toBe(
        true,
      );
      const final = (await alice.get(`/api/itineraries/${trip}`).expect(200))
        .body;
      expect(final.days).toHaveLength(ok);
      expect(final.days.map((d: DayBody) => d.dayNumber)).toEqual(
        Array.from({ length: ok }, (_, i) => i + 1),
      );
      // Every day was saved exactly once.
      expect(
        new Set(final.days.map((d: { notes: string }) => d.notes)).size,
      ).toBe(ok);
      expect(ok).toBeGreaterThanOrEqual(8);
    });

    it('never goes over 60 days, even with parallel requests (ITN-05)', async () => {
      const trip = (await create(alice, { title: 'Long trip' }).expect(201))
        .body.id;
      await connection.collection('itineraries').updateOne(
        { _id: new Types.ObjectId(trip) },
        {
          $set: {
            days: Array.from({ length: 58 }, () => ({
              _id: new Types.ObjectId(),
              cityId: 'cairo',
              notes: '',
              activities: [],
              budgetEntries: [],
            })),
          },
        },
      );
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          alice.post(`/api/itineraries/${trip}/days`).send({ cityId: 'luxor' }),
        ),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(2);
      expect(
        statuses.filter((s) => s !== 200).every((s) => s === 400 || s === 409),
      ).toBe(true);
      const final = (await alice.get(`/api/itineraries/${trip}`).expect(200))
        .body;
      expect(final.dayCount).toBe(60);
      expect(final.days[59].date).toBe('2027-02-27');
      await alice
        .delete(`/api/itineraries/${trip}`)
        .send({ confirm: true })
        .expect(200);
    });

    it('keeps at most 5 images per activity under parallel uploads (ITN-12, GEN-08)', async () => {
      const start = (await alice.get(`/api/itineraries/${tripId}`).expect(200))
        .body;
      const day = start.days[1] as DayBody;
      const activity = day.activities[0];
      const path = `/api/itineraries/${tripId}/days/${day.id}/activities/${activity.id}/images`;

      await alice
        .post(path)
        .attach('file', Buffer.from('not an image'), 'x.jpg')
        .expect(400);
      await bob.post(path).attach('file', JPEG_BYTES, 'x.jpg').expect(404); // private

      const results = await Promise.all(
        Array.from({ length: 7 }, () =>
          alice.post(path).attach('file', JPEG_BYTES, 'museum.jpg'),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(5);
      expect(results.every((r) => [200, 400, 409].includes(r.status))).toBe(
        true,
      );

      const after = (await alice.get(`/api/itineraries/${tripId}`).expect(200))
        .body;
      const images = after.days[1].activities[0].images as {
        imageId: string;
        url: string;
      }[];
      expect(images).toHaveLength(5);
      expect(
        await connection
          .collection('uploads')
          .countDocuments({ ownerId: activity.id }),
      ).toBe(5);
      expect(readdirSync(uploadDir)).toHaveLength(5);
      await guest().get(images[0].url).expect(200);

      // Remove one: the file goes too.
      const removed = await alice
        .delete(`${path}/${images[4].imageId}`)
        .expect(200);
      expect(removed.body.days[1].activities[0].images).toHaveLength(4);
      await guest().get(images[4].url).expect(404);
    });
  });

  describe('budget conversion (ITN-18, ACC-09)', () => {
    // Budget at this point: EGP 100.25 and USD 110 (see above).
    // Fake rates: 1 USD = 40 EGP = 0.7 JOD.

    it('converts every total to USD when the user has no preferred currency', async () => {
      const res = await alice.get(`/api/itineraries/${tripId}`).expect(200);
      expect(res.body.budget.conversion).toEqual({
        currency: 'USD',
        rateDate: '2026-11-16',
        usingCachedRates: false,
      });
      expect(res.body.budget.total.converted).toBe(112.51); // 100.25/40 + 110
      expect(res.body.budget.byCategory.food.converted).toBe(2.51);
      expect(res.body.days[1].budgetEntries[0].convertedAmount).toBe(2.51);
      expect(fakeFx.fetchLatest).toHaveBeenCalledTimes(1); // once per day
    });

    it("uses ?currency=, else the user's preferred currency", async () => {
      const egp = await alice
        .get(`/api/itineraries/${tripId}/budget`)
        .query({ currency: 'EGP' })
        .expect(200);
      expect(egp.body.total.converted).toBe(4500.25); // 100.25 + 110*40
      expect(egp.body.conversion.currency).toBe('EGP');

      // ACC-09: the user sets a preferred currency on their profile.
      await alice
        .patch('/api/users/me')
        .send({ preferredCurrency: 'JOD' })
        .expect(200);
      const jod = await alice
        .get(`/api/itineraries/${tripId}/budget`)
        .expect(200);
      expect(jod.body.conversion.currency).toBe('JOD');
      expect(jod.body.total.converted).toBe(78.75); // 112.50625 * 0.7

      await alice
        .get(`/api/itineraries/${tripId}`)
        .query({ currency: 'XYZ' })
        .expect(400);
      await alice
        .get(`/api/itineraries/${tripId}/budget`)
        .query({ currency: 'usd' })
        .expect(400);
      await bob.get(`/api/itineraries/${tripId}/budget`).expect(404); // private

      // The profile accepts any 3 letters (ACC-09 is Person 1's); an
      // unsupported preference falls back to USD instead of failing.
      await alice
        .patch('/api/users/me')
        .send({ preferredCurrency: 'XYZ' })
        .expect(200);
      const fallback = await alice
        .get(`/api/itineraries/${tripId}/budget`)
        .expect(200);
      expect(fallback.body.conversion.currency).toBe('USD');
      await connection
        .collection('users')
        .updateOne({ _id: aliceId }, { $unset: { preferredCurrency: '' } });
    });

    it('falls back to cached rates, and answers 503 only when nothing is cached', async () => {
      await connection.collection('fx_rate_snapshots').deleteMany({});
      fakeFx.fetchLatest.mockRejectedValue(
        new FxApiError('FX API unreachable'),
      );

      // Nothing cached: the itinerary still loads, without conversion.
      const detail = await alice.get(`/api/itineraries/${tripId}`).expect(200);
      expect(detail.body.budget.conversion).toBeNull();
      expect(detail.body.budget.conversionError).toMatch(/unavailable/);
      await alice.get(`/api/itineraries/${tripId}/budget`).expect(503);

      // An older snapshot exists: it is used, and the response says so.
      await connection.collection('fx_rate_snapshots').insertOne({
        day: '2026-11-01',
        base: 'USD',
        rateDate: '2026-11-01',
        rates: { USD: 1, EGP: 50, JOD: 0.7 },
        fetchedAt: new Date(),
      });
      const cached = await alice
        .get(`/api/itineraries/${tripId}/budget`)
        .expect(200);
      expect(cached.body.conversion).toEqual({
        currency: 'USD',
        rateDate: '2026-11-01',
        usingCachedRates: true,
      });
      expect(cached.body.total.converted).toBe(112.01); // 100.25/50 + 110

      // Back to normal for the rest of the suite.
      fakeFx.fetchLatest.mockResolvedValue(FAKE_RATES);
      await connection.collection('fx_rate_snapshots').insertOne({
        day: new Date().toISOString().slice(0, 10),
        ...FAKE_RATES,
        fetchedAt: new Date(),
      });
    });
  });

  describe('access, visibility and search (ITN-20, ITN-21, ACC-11, ACC-12, GEN-10)', () => {
    it('keeps a private itinerary to its owner (admins too get 404)', async () => {
      await guest().get(`/api/itineraries/${tripId}`).expect(404);
      await bob.get(`/api/itineraries/${tripId}`).expect(404);
      await admin.get(`/api/itineraries/${tripId}`).expect(404);
      await bob
        .patch(`/api/itineraries/${tripId}`)
        .send({ title: 'Mine now' })
        .expect(404);
      await bob.post(`/api/itineraries/${tripId}/clone`).expect(404);
    });

    it('shares a public itinerary read-only, and Private removes it at once', async () => {
      await alice
        .patch(`/api/itineraries/${tripId}/visibility`)
        .send({ isPublic: true })
        .expect(200);
      const view = await guest().get(`/api/itineraries/${tripId}`).expect(200);
      expect(view.body).toMatchObject({
        isPublic: true,
        isOwner: false,
        author: { name: 'Alice Traveller' },
      });
      await bob
        .patch(`/api/itineraries/${tripId}`)
        .send({ title: 'Mine now' })
        .expect(403);
      await bob
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'cairo' })
        .expect(403);

      const found = await guest()
        .get('/api/itineraries')
        .query({ q: 'egypt' })
        .expect(200);
      expect(found.body.items.map((i: { id: string }) => i.id)).toContain(
        tripId,
      );

      await alice
        .patch(`/api/itineraries/${tripId}/visibility`)
        .send({ isPublic: false })
        .expect(200);
      const gone = await guest()
        .get('/api/itineraries')
        .query({ q: 'egypt' })
        .expect(200);
      expect(gone.body.items).toEqual([]);
      await guest().get(`/api/itineraries/${tripId}`).expect(404);
      await alice
        .patch(`/api/itineraries/${tripId}/visibility`)
        .send({ isPublic: true })
        .expect(200);
    });

    it('searches by title, country or city, filters by days, and pages by 10', async () => {
      // 11 more public itineraries, each with 1 day in Amman.
      for (let i = 0; i < 11; i++) {
        const id = (
          await create(bob, { title: `Jordan ${i}`, countries: ['JO'] }).expect(
            201,
          )
        ).body.id;
        await bob
          .post(`/api/itineraries/${id}/days`)
          .send({ cityId: 'amman' })
          .expect(200);
        await bob
          .patch(`/api/itineraries/${id}/visibility`)
          .send({ isPublic: true })
          .expect(200);
      }
      const ids = (res: request.Response) =>
        res.body.items.map((i: { id: string }) => i.id);

      expect(
        ids(await guest().get('/api/itineraries').query({ q: 'Egypt, upd' })),
      ).toEqual([tripId]);
      expect(
        ids(await guest().get('/api/itineraries').query({ q: 'aswan' })),
      ).toEqual([tripId]);
      expect(
        ids(await guest().get('/api/itineraries').query({ q: 'EG' })),
      ).toContain(tripId);
      expect(
        ids(await guest().get('/api/itineraries').query({ cityId: 'cairo' })),
      ).toEqual([tripId]);
      expect(
        ids(await guest().get('/api/itineraries').query({ minDays: 2 })),
      ).toEqual([tripId]);

      const page1 = await guest()
        .get('/api/itineraries')
        .query({ country: 'JO' })
        .expect(200);
      expect(page1.body).toMatchObject({ total: 11, totalPages: 2, limit: 10 });
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.items[0]).toMatchObject({
        dayCount: 1,
        author: { name: 'Bob Reader' },
      });
      const page2 = await guest()
        .get('/api/itineraries')
        .query({ country: 'JO', page: 2 })
        .expect(200);
      expect(page2.body.items).toHaveLength(1);

      await guest()
        .get('/api/itineraries')
        .query({ minDays: 5, maxDays: 2 })
        .expect(400);
    });

    it('hides an itinerary hidden by an admin from everyone but its owner and admins (GEN-10)', async () => {
      await admin
        .patch(`/api/admin/content/itinerary/${tripId}/hide`)
        .send({})
        .expect(200);
      await guest().get(`/api/itineraries/${tripId}`).expect(404);
      await bob.get(`/api/itineraries/${tripId}`).expect(404);
      const own = await alice.get(`/api/itineraries/${tripId}`).expect(200);
      expect(own.body.isHidden).toBe(true);
      await admin.get(`/api/itineraries/${tripId}`).expect(200);
      const search = await guest()
        .get('/api/itineraries')
        .query({ q: 'aswan' })
        .expect(200);
      expect(search.body.items).toEqual([]);
      const mine = await alice.get('/api/itineraries/mine').expect(200);
      expect(
        mine.body.items.find((i: { id: string }) => i.id === tripId).isHidden,
      ).toBe(true);
      await admin
        .patch(`/api/admin/content/itinerary/${tripId}/unhide`)
        .send({})
        .expect(200);
    });

    it("hides a deactivated user's public itineraries from everyone but admins (ACC-12)", async () => {
      await connection
        .collection('users')
        .updateOne({ _id: aliceId }, { $set: { status: 'deactivated' } });
      await guest().get(`/api/itineraries/${tripId}`).expect(404);
      await bob.get(`/api/itineraries/${tripId}`).expect(404);
      await admin.get(`/api/itineraries/${tripId}`).expect(200);
      const search = await guest()
        .get('/api/itineraries')
        .query({ q: 'aswan' })
        .expect(200);
      expect(search.body.items).toEqual([]);
      await connection
        .collection('users')
        .updateOne({ _id: aliceId }, { $set: { status: 'active' } });
    });
  });

  describe('PDF export (ITN-28, bonus)', () => {
    const pdf = (agent: TestAgent | ReturnType<typeof guest>, id: string) =>
      agent.get(`/api/itineraries/${id}/pdf`).buffer(true).parse(binary);

    it('downloads the itinerary as a PDF named after its id', async () => {
      const res = await pdf(alice, tripId).expect(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe(
        `attachment; filename="itinerary-${tripId}.pdf"`,
      );
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(Number(res.headers['content-length'])).toBe(body.length);
    });

    it('follows the same visibility rules as viewing it', async () => {
      // tripId is public at this point: guests may export it read-only.
      await pdf(guest(), tripId).expect(200);

      const privateTrip = await create(alice, { title: 'Secret trip' }).expect(
        201,
      );
      const id = privateTrip.body.id as string;
      await pdf(alice, id).expect(200);
      await pdf(guest(), id).expect(404);
      await pdf(bob, id).expect(404);
      await pdf(admin, id).expect(404);
      await pdf(alice, new Types.ObjectId().toString()).expect(404);
      await alice.get('/api/itineraries/not-an-id/pdf').expect(400);
      await alice
        .get(`/api/itineraries/${id}/pdf`)
        .query({ currency: 'XYZ' })
        .expect(400);
    });
  });

  describe('clone and delete (ITN-21, ITN-01, GEN-10)', () => {
    let cloneId: string;

    it('clones into an independent private copy that credits the author', async () => {
      await guest().post(`/api/itineraries/${tripId}/clone`).expect(401);
      await admin.post(`/api/itineraries/${tripId}/clone`).expect(403);
      const original = (
        await alice.get(`/api/itineraries/${tripId}`).expect(200)
      ).body;

      const res = await bob
        .post(`/api/itineraries/${tripId}/clone`)
        .expect(201);
      cloneId = res.body.id;
      expect(res.body).toMatchObject({
        title: original.title,
        isPublic: false,
        isOwner: true,
        author: { name: 'Bob Reader' },
        clonedFrom: {
          itineraryId: tripId,
          author: { name: 'Alice Traveller' },
        },
        dayCount: original.dayCount,
      });
      // Same money, new day ids.
      expect(res.body.budget.byCategory).toEqual(original.budget.byCategory);
      expect(res.body.budget.total).toEqual(original.budget.total);
      expect(res.body.days.map((d: DayBody) => d.cityId)).toEqual(
        original.days.map((d: DayBody) => d.cityId),
      );
      // New ids and new image files.
      expect(res.body.days[1].id).not.toBe(original.days[1].id);
      const originalUrls = original.days[1].activities[0].images.map(
        (i: { url: string }) => i.url,
      );
      const cloneUrls = res.body.days[1].activities[0].images.map(
        (i: { url: string }) => i.url,
      );
      expect(cloneUrls).toHaveLength(4);
      expect(cloneUrls.some((u: string) => originalUrls.includes(u))).toBe(
        false,
      );

      // Changing the clone leaves the original alone.
      await bob
        .patch(`/api/itineraries/${cloneId}`)
        .send({ title: 'My copy' })
        .expect(200);
      const again = (await alice.get(`/api/itineraries/${tripId}`).expect(200))
        .body;
      expect(again.title).toBe(original.title);
    });

    it('deletes after confirmation; open reports close, clones stay intact (ITN-01)', async () => {
      await bob
        .post('/api/reports')
        .send({ targetType: 'itinerary', targetId: tripId, reason: 'spam' })
        .expect(201);
      const original = (
        await alice.get(`/api/itineraries/${tripId}`).expect(200)
      ).body;
      const originalUrl = original.days[1].activities[0].images[0].url;

      await alice.delete(`/api/itineraries/${tripId}`).expect(400);
      await bob
        .delete(`/api/itineraries/${tripId}`)
        .send({ confirm: true })
        .expect(403);
      await alice
        .delete(`/api/itineraries/${tripId}`)
        .send({ confirm: true })
        .expect(200);

      await alice.get(`/api/itineraries/${tripId}`).expect(404);
      const report = await connection
        .collection('reports')
        .findOne({ targetId: new Types.ObjectId(tripId) });
      expect(report).toMatchObject({
        status: 'content_deleted',
        resolutionNote: 'Deleted by owner',
      });
      await guest().get(originalUrl).expect(404);

      const clone = (await bob.get(`/api/itineraries/${cloneId}`).expect(200))
        .body;
      expect(clone.clonedFrom.author.name).toBe('Alice Traveller');
      await guest().get(clone.days[1].activities[0].images[0].url).expect(200);
    });

    it('lets an admin delete an itinerary through moderation (no longer 501)', async () => {
      await bob
        .patch(`/api/itineraries/${cloneId}/visibility`)
        .send({ isPublic: true })
        .expect(200);
      const clone = (await bob.get(`/api/itineraries/${cloneId}`).expect(200))
        .body;
      const imageUrl = clone.days[1].activities[0].images[0].url;

      await admin.delete(`/api/admin/content/itinerary/${cloneId}`).expect(200);
      await bob.get(`/api/itineraries/${cloneId}`).expect(404);
      await guest().get(imageUrl).expect(404);
    });
  });
});
