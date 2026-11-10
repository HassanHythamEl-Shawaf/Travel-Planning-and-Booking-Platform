/**
 * Flight booking e2e (FLT-19, FLT-21, FLT-22, FLT-23, FLT-25, FLT-29,
 * FLT-06, ACC-12). Boots the whole AppModule over HTTP against an in-memory
 * MongoDB replica set, never Atlas. Payment is simulated by calling the
 * FLIGHT_BOOKING_PAYMENTS contract the way the Stripe webhook will.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { DateTime } from 'luxon';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import {
  CabinCategory,
  Flight,
  FlightStatus,
} from '../src/airlines/schemas/flight.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { FLIGHT_BOOKING_PAYMENTS } from '../src/flight-bookings/flight-booking-payments.contract';
import type { FlightBookingPayments } from '../src/flight-bookings/flight-booking-payments.contract';

jest.setTimeout(180_000);

/** Collects a binary response (the PDF) into a Buffer. */
const binary = (
  res: NodeJS.ReadableStream,
  done: (error: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

describe('Flight bookings (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let admin: TestAgent;
  let traveller: TestAgent;
  let moderator: TestAgent;
  let travellerId: string;
  let flightId: string;

  const PASSWORD = 'Password123';

  const login = async (email: string, password: string) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(201);
    return agent;
  };

  const insertUser = async (email: string, role: 'admin' | 'user') => {
    const now = new Date();
    const result = await connection.collection('users').insertOne({
      name: role === 'admin' ? 'E2E Admin' : 'Sara Hassan',
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
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
    return result.insertedId.toString();
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('e2e-flight-bookings');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    await insertUser('admin@e2e.test', 'admin');
    travellerId = await insertUser('sara@e2e.test', 'user');
    const airline = await connection.collection('airlines').insertOne({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
      logoUrl: null,
      baggagePolicy: { pricePerExtraBag: 50, maxExtraBagsPerPassenger: 2 },
      cancellationPolicy: [{ daysBeforeDeparture: 0, refundPercentage: 25 }],
    });
    const airlineId = airline.insertedId.toString();

    const departure = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: 30 })
      .set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
    const flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    const flight = await flights.create({
      airlineId: airline.insertedId,
      flightNumber: 'NA101',
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'LHR',
      departureAt: departure.toUTC().toJSDate(),
      arrivalAt: departure.plus({ hours: 5 }).toUTC().toJSDate(),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Europe/London',
      departureLocalDate: departure.toISODate()!,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          seatCount: 3,
          price: 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
        },
      ],
    });
    flightId = flight._id.toString();

    admin = await login('admin@e2e.test', PASSWORD);
    traveller = await login('sara@e2e.test', PASSWORD);

    await admin
      .post('/api/admin/moderators')
      .send({
        name: 'Mona Moderator',
        email: 'mona@e2e.test',
        temporaryPassword: 'temp',
        providerType: 'airline',
        providerId: airlineId,
      })
      .expect(201);
    const firstLogin = await login('mona@e2e.test', 'temp');
    await firstLogin
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'temp', newPassword: 'ModPass123' })
      .expect(200);
    moderator = await login('mona@e2e.test', 'ModPass123');
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  const body = (documentNumber: string) => ({
    outbound: { flightId, cabinCategory: 'Economy' },
    passengers: [
      {
        fullName: 'Sara Hassan',
        dateOfBirth: '1990-05-05',
        documentNumber,
        type: 'Adult',
        extraBags: 1,
        extraBaggageWeightKg: 20,
      },
    ],
  });

  it('books, pays, lists, then the airline cancels the flight', async () => {
    // FLT-19 / FLT-21: summary, nothing held.
    const summary = await traveller
      .post('/api/flight-bookings')
      .send(body('DOC00001'))
      .expect(200);
    expect(summary.body).toMatchObject({
      totalPrice: 250,
      baggageFees: 50,
      seats: 1,
    });

    // Only registered users may book; moderators may not.
    await moderator
      .post('/api/flight-bookings/hold')
      .send(body('DOC00002'))
      .expect(403);
    await request(server)
      .post('/api/flight-bookings/hold')
      .send(body('DOC00002'))
      .expect(401);

    // FLT-22: hold.
    const held = await traveller
      .post('/api/flight-bookings/hold')
      .send(body('DOC00003'))
      .expect(201);
    expect(held.body).toMatchObject({
      status: 'Pending Payment',
      bookingReference: null,
    });
    const bookingId: string = held.body.id;

    // FLT-23: the webhook confirms through the payments contract.
    const payments = app.get<FlightBookingPayments>(FLIGHT_BOOKING_PAYMENTS);
    const { bookingReference } = await payments.confirmBooking(bookingId);

    // FLT-25: listed and readable by the owner.
    const upcoming = await traveller
      .get('/api/flight-bookings?group=upcoming')
      .expect(200);
    expect(upcoming.body.items.map((i: { id: string }) => i.id)).toEqual([
      bookingId,
    ]);
    expect(upcoming.body.counts).toEqual({
      upcoming: 1,
      past: 0,
      cancelled: 0,
    });
    await traveller.get(`/api/flight-bookings/${bookingId}`).expect(200);

    // FLT-23: the e-ticket downloads as a PDF once confirmed.
    const ticket = await traveller
      .get(`/api/flight-bookings/${bookingId}/e-ticket`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(ticket.headers['content-type']).toBe('application/pdf');
    expect(ticket.headers['content-disposition']).toBe(
      `attachment; filename="e-ticket-${bookingReference}.pdf"`,
    );
    expect((ticket.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    // ACC-12: deactivation is blocked by the upcoming Confirmed booking.
    await traveller.delete('/api/users/me').send({ confirm: true }).expect(409);

    // FLT-29: the airline moderator sees it, and can export it.
    const listed = await moderator
      .get(`/api/airlines/flights/${flightId}/bookings`)
      .expect(200);
    expect(listed.body.items).toEqual([
      expect.objectContaining({
        bookingReference,
        passengers: [expect.objectContaining({ name: 'Sara Hassan' })],
        cabin: 'Economy',
        seats: 1,
        status: 'Confirmed',
        remainingSeats: 2,
      }),
    ]);
    const csv = await moderator
      .get(`/api/airlines/flights/${flightId}/bookings/export`)
      .expect(200);
    expect(csv.text).toContain(bookingReference);

    // A second, unpaid booking is still on hold when the flight is cancelled.
    const unpaid = await traveller
      .post('/api/flight-bookings/hold')
      .send(body('DOC00004'))
      .expect(201);
    await traveller
      .get(`/api/flight-bookings/${unpaid.body.id}/e-ticket`)
      .expect(409);

    // FLT-06: the airline cancels the flight.
    await moderator
      .post(`/api/airlines/flights/${flightId}/cancel`)
      .send({ confirm: true })
      .expect(201);

    const details = await traveller
      .get(`/api/flight-bookings/${bookingId}`)
      .expect(200);
    expect(details.body).toMatchObject({
      status: 'Cancelled',
      cancellationSource: 'flight-cancelled',
      refundPercentage: 100,
      refundAmount: 250,
    });
    await traveller
      .get(`/api/flight-bookings/${bookingId}/e-ticket`)
      .expect(409);
    const expired = await traveller
      .get(`/api/flight-bookings/${unpaid.body.id}`)
      .expect(200);
    expect(expired.body.status).toBe('Expired');

    const flight = await connection
      .collection('flights')
      .findOne({ status: 'Cancelled' });
    expect(flight!.cabins[0]).toMatchObject({ seatsBooked: 0, seatsHeld: 0 });

    // The affected user is told the flight was cancelled (GEN-01).
    const notices = await connection
      .collection('notifications')
      .find({ type: 'FLIGHT_CANCELLED' })
      .toArray();
    expect(notices.map((n) => n.userId.toString())).toEqual([travellerId]);

    // With nothing upcoming, deactivation is allowed (ACC-12).
    await traveller.delete('/api/users/me').send({ confirm: true }).expect(200);
  });

  it('never sells more seats than exist under parallel HTTP holds (FLT-22)', async () => {
    const airline = await connection
      .collection('airlines')
      .findOne({ code: 'NA' });
    const departure = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: 20 })
      .set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const flights = app.get<Model<Flight>>(getModelToken(Flight.name));
    const flight = await flights.create({
      airlineId: airline!._id,
      flightNumber: 'NA201',
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureAt: departure.toUTC().toJSDate(),
      arrivalAt: departure.plus({ hours: 3 }).toUTC().toJSDate(),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Asia/Dubai',
      departureLocalDate: departure.toISODate()!,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          seatCount: 5,
          price: 150,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
        },
      ],
    });

    // Four travellers each fire five hold requests for one seat, all at once.
    const travellers = await Promise.all(
      [1, 2, 3, 4].map(async (n) => {
        await insertUser(`rush${n}@e2e.test`, 'user');
        return login(`rush${n}@e2e.test`, PASSWORD);
      }),
    );
    const hold = (agent: TestAgent, i: number) =>
      agent.post('/api/flight-bookings/hold').send({
        outbound: { flightId: flight._id.toString(), cabinCategory: 'Economy' },
        passengers: [
          {
            fullName: `Passenger ${i}`,
            dateOfBirth: '1988-03-03',
            documentNumber: `RUSH${1000 + i}`,
            type: 'Adult',
          },
        ],
      });
    const responses = await Promise.all(
      travellers.flatMap((agent, a) =>
        [0, 1, 2, 3, 4].map((r) => hold(agent, a * 5 + r)),
      ),
    );

    const created = responses.filter((r) => r.status === 201);
    expect(created).toHaveLength(5);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(15);
    expect(responses.every((r) => [201, 409].includes(r.status))).toBe(true);

    const cabinAfterHolds = (await flights.findById(flight._id).lean().exec())!
      .cabins[0];
    expect(cabinAfterHolds).toMatchObject({ seatsHeld: 5, seatsBooked: 0 });

    // Paying for all five turns every held seat into a booked one.
    const payments = app.get<FlightBookingPayments>(FLIGHT_BOOKING_PAYMENTS);
    await Promise.all(created.map((r) => payments.confirmBooking(r.body.id)));
    const cabinAfterPayment = (await flights
      .findById(flight._id)
      .lean()
      .exec())!.cabins[0];
    expect(cabinAfterPayment).toMatchObject({ seatsHeld: 0, seatsBooked: 5 });

    // The flight is full now.
    await hold(travellers[0], 99).expect(409);
  });
});
