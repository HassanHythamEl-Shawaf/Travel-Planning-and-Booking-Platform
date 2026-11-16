/**
 * ITN-25 / ITN-26 e2e: hotel and flight lookups for an itinerary, through
 * the real hotel search (HTL-11) and flight search (FLT-11, FLT-12). Whole
 * AppModule, in-memory replica set, fake exchange rates. Never Atlas.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import {
  CabinCategory,
  Flight,
  FlightStatus,
} from '../src/airlines/schemas/flight.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { FX_RATES_CLIENT } from '../src/fx-rates/fx-rates.constants';
import { Hotel } from '../src/hotels/schemas/hotel.schema';
import { RoomAvailability } from '../src/hotels/schemas/room-availability.schema';
import { Room } from '../src/hotels/schemas/room.schema';

jest.setTimeout(180_000);

const DAY = 24 * 60 * 60 * 1000;
/** A date `n` days from today, YYYY-MM-DD (UTC). */
const plusDays = (n: number) =>
  new Date(Date.now() + n * DAY).toISOString().slice(0, 10);

describe('Itinerary hotel and flight search (e2e, ITN-25, ITN-26)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let alice: TestAgent;
  let bob: TestAgent;
  let tripId: string; // Cairo, Luxor, Luxor, Cairo
  const START = plusDays(30);

  const PASSWORD = 'TravelPass123';

  const insertUser = async (email: string, name: string) => {
    const now = new Date();
    await connection.collection('users').insertOne({
      name,
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role: 'user',
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
  };

  const login = async (email: string) => {
    const agent = request.agent(server);
    await agent
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(201);
    return agent;
  };

  const trip = async (startDate: string, cities: string[]) => {
    const res = await alice
      .post('/api/itineraries')
      .send({ title: 'Trip', countries: ['EG'], startDate })
      .expect(201);
    for (const cityId of cities) {
      await alice
        .post(`/api/itineraries/${res.body.id}/days`)
        .send({ cityId })
        .expect(200);
    }
    return res.body.id as string;
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('itinerary-search-e2e');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FX_RATES_CLIENT)
      .useValue({
        fetchLatest: async () => ({
          base: 'USD',
          rateDate: plusDays(0),
          rates: { USD: 1 },
        }),
      })
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

    // Reference data.
    await connection.collection('countries').insertMany([
      { _id: 'EG' as never, name: 'Egypt', currency: 'EGP' },
      { _id: 'GB' as never, name: 'United Kingdom', currency: 'GBP' },
    ]);
    await connection.collection('cities').insertMany([
      { _id: 'cairo' as never, name: 'Cairo', countryCode: 'EG' },
      { _id: 'luxor' as never, name: 'Luxor', countryCode: 'EG' },
      { _id: 'london' as never, name: 'London', countryCode: 'GB' },
    ]);
    await connection.collection('airports').insertMany([
      {
        _id: 'CAI' as never,
        name: 'Cairo International',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: 'LXR' as never,
        name: 'Luxor International',
        cityId: 'luxor',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: 'LHR' as never,
        name: 'Heathrow',
        cityId: 'london',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      },
      {
        _id: 'LGW' as never,
        name: 'Gatwick',
        cityId: 'london',
        countryCode: 'GB',
        timeZone: 'Europe/London',
      },
    ]);
    await connection
      .collection('currencies')
      .insertOne({ _id: 'USD' as never, countryCodes: ['US'] });

    // Hotels and rooms in Luxor (HTL-11 data).
    const hotels = app.get<Model<Hotel>>(getModelToken(Hotel.name));
    const rooms = app.get<Model<Room>>(getModelToken(Room.name));
    const blocks = app.get<Model<RoomAvailability>>(
      getModelToken(RoomAvailability.name),
    );
    const hotel = (name: string, city: string, isActive = true) =>
      hotels.create({
        name,
        description: 'x',
        address: '1 Nile St',
        city,
        country: 'Egypt',
        isActive,
      });
    const room = (
      hotelId: Types.ObjectId,
      name: string,
      maxAdults: number,
      maxChildren: number,
      price = 100,
    ) =>
      rooms.create({
        hotelId,
        name,
        pricePerNight: price,
        occupancy: { maxAdults, maxChildren },
      });

    const nileView = await hotel('Nile View', 'Luxor');
    await room(nileView._id, 'Family', 2, 1, 120); // 3 people
    await room(nileView._id, 'Double', 2, 0, 90); // 2 people
    const smallInn = await hotel('Small Inn', 'luxor');
    await room(smallInn._id, 'Single', 1, 0);
    const palace = await hotel('Booked Palace', 'Luxor');
    await room(palace._id, 'Suite A', 2, 2);
    const booked = await room(palace._id, 'Suite B', 2, 2);
    await blocks.create({
      roomId: booked._id,
      startDate: new Date(`${plusDays(31)}T00:00:00Z`),
      endDate: new Date(`${plusDays(32)}T00:00:00Z`),
      status: 'booked',
    });
    const elsewhere = await hotel('Luxor Hotel', 'Cairo'); // name matches, city doesn't
    await room(elsewhere._id, 'Big', 4, 4);
    const closed = await hotel('Closed Luxor', 'Luxor', false);
    await room(closed._id, 'Big', 4, 4);

    // Flights LHR -> CAI on the start date, and back on the last day.
    const airline = await connection
      .collection('airlines')
      .insertOne({
        name: 'Nile Air',
        code: 'NA',
        isActive: true,
        logoUrl: null,
      });
    const flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    const flight = (number: string, from: string, to: string, date: string) =>
      flights.create({
        airlineId: airline.insertedId,
        flightNumber: number,
        departureAirportCode: from,
        arrivalAirportCode: to,
        departureAt: new Date(`${date}T08:00:00Z`),
        arrivalAt: new Date(`${date}T13:00:00Z`),
        departureTimeZone: 'UTC',
        arrivalTimeZone: 'UTC',
        departureLocalDate: date,
        status: FlightStatus.SCHEDULED,
        cabins: [
          {
            category: CabinCategory.ECONOMY,
            seatCount: 50,
            price: 300,
            freeBaggageAllowance: 1,
            maxWeightPerBagKg: 23,
          },
        ],
      });
    await flight('NA1', 'LHR', 'CAI', START);
    await flight('NA2', 'CAI', 'LHR', plusDays(33));

    await insertUser('alice@s.test', 'Alice');
    await insertUser('bob@s.test', 'Bob');
    alice = await login('alice@s.test');
    bob = await login('bob@s.test');
    tripId = await trip(START, ['cairo', 'luxor', 'luxor', 'cairo']);
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  describe('hotels for a city group (ITN-25)', () => {
    const hotels = (query: Record<string, unknown>) =>
      alice.get(`/api/itineraries/${tripId}/hotels`).query(query);

    it("uses the group's dates and needs N rooms that fit the guests together", async () => {
      const res = await hotels({ group: 2, guests: 4, rooms: 2 }).expect(200);
      expect(res.body.stay).toEqual({
        group: 2,
        cityId: 'luxor',
        cityName: 'Luxor',
        checkIn: plusDays(31),
        checkOut: plusDays(33), // the day after the last Luxor day
        nights: 2,
        guests: 4,
        rooms: 2,
      });
      // Nile View: 3 + 2 >= 4. Small Inn: only 1 room. Booked Palace: Suite B
      // is booked, so 1 free room. "Luxor Hotel" is in Cairo; "Closed Luxor" is inactive.
      expect(res.body.items.map((h: { name: string }) => h.name)).toEqual([
        'Nile View',
      ]);
      expect(res.body.items[0]).toMatchObject({
        availableRoomCount: 2,
        startingPrice: 90,
      });
      expect(res.body).toMatchObject({ total: 1, page: 1, limit: 10 });
    });

    it('with one room for 4 guests, only a room for 4 qualifies', async () => {
      const res = await hotels({ group: 2, guests: 4, rooms: 1 }).expect(200);
      expect(res.body.items.map((h: { name: string }) => h.name)).toEqual([
        'Booked Palace',
      ]);
      expect(
        res.body.items[0].rooms.map((r: { name: string }) => r.name),
      ).toEqual(['Suite A']);
    });

    it('rejects bad groups, more rooms than guests, past dates and other users', async () => {
      await hotels({ group: 4, guests: 2, rooms: 1 }).expect(400);
      await hotels({ group: 2, guests: 1, rooms: 2 }).expect(400);
      await hotels({ group: 2, guests: 0, rooms: 1 }).expect(400);
      await hotels({ guests: 2, rooms: 1 }).expect(400);
      await bob
        .get(`/api/itineraries/${tripId}/hotels`)
        .query({ group: 1, guests: 1, rooms: 1 })
        .expect(404);
      await request(server)
        .get(`/api/itineraries/${tripId}/hotels`)
        .expect(401);

      const past = await trip(plusDays(-10), ['luxor']);
      await alice
        .get(`/api/itineraries/${past}/hotels`)
        .query({ group: 1, guests: 1, rooms: 1 })
        .expect(400);
    });
  });

  describe('flights to the city of day 1 (ITN-26)', () => {
    it("lists the airports of the first day's city", async () => {
      const res = await alice
        .get(`/api/itineraries/${tripId}/flights/airports`)
        .expect(200);
      expect(res.body).toEqual({
        cityId: 'cairo',
        cityName: 'Cairo',
        airports: [{ code: 'CAI', name: 'Cairo International' }],
      });
    });

    it('searches one-way on the start date by default (one airport, so no `to` needed)', async () => {
      const res = await alice
        .get(`/api/itineraries/${tripId}/flights`)
        .query({ from: 'lhr' })
        .expect(200);
      expect(res.body.search).toEqual({
        from: 'LHR',
        to: 'CAI',
        tripType: 'one-way',
        departureDate: START,
        returnDate: null,
      });
      expect(
        res.body.items.map((f: { flightNumber: string }) => f.flightNumber),
      ).toEqual(['NA1']);
      expect(res.body.returnItems).toBeUndefined();
    });

    it("searches round trips returning on the last day's date", async () => {
      const res = await alice
        .get(`/api/itineraries/${tripId}/flights`)
        .query({ from: 'LHR', tripType: 'round-trip', adults: 2 })
        .expect(200);
      expect(res.body.search.returnDate).toBe(plusDays(33));
      expect(
        res.body.items.map((f: { flightNumber: string }) => f.flightNumber),
      ).toEqual(['NA1']);
      expect(
        res.body.returnItems.map(
          (f: { flightNumber: string }) => f.flightNumber,
        ),
      ).toEqual(['NA2']);

      // Another date: nothing found.
      const other = await alice
        .get(`/api/itineraries/${tripId}/flights`)
        .query({ from: 'LHR', departureDate: plusDays(40) })
        .expect(200);
      expect(other.body.items).toEqual([]);
    });

    it('needs `to` when the city has several airports, and it must be one of them', async () => {
      const london = await trip(START, ['london']);
      const res = await alice
        .get(`/api/itineraries/${london}/flights`)
        .query({ from: 'CAI' })
        .expect(400);
      expect(res.body.message).toContain('LGW, LHR');
      await alice
        .get(`/api/itineraries/${london}/flights`)
        .query({ from: 'CAI', to: 'CAI' })
        .expect(400);
      await alice
        .get(`/api/itineraries/${london}/flights`)
        .query({ from: 'CAI', to: 'LHR' })
        .expect(200);

      const empty = (
        await alice
          .post('/api/itineraries')
          .send({ title: 'Empty', countries: ['EG'], startDate: START })
          .expect(201)
      ).body.id;
      await alice
        .get(`/api/itineraries/${empty}/flights`)
        .query({ from: 'LHR' })
        .expect(400);
      await bob
        .get(`/api/itineraries/${tripId}/flights`)
        .query({ from: 'LHR' })
        .expect(404);
    });
  });
});
