import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { CabinCategory } from '../airlines/schemas/flight.schema';
import { FlightBookingGroup } from './dto/list-flight-bookings.dto';
import {
  CancellationSource,
  PassengerType,
  SegmentDirection,
  TripType,
} from './flight-booking.constants';
import { FlightBookingStatus } from './flight-booking-status';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

jest.setTimeout(120_000);

const HOUR = 60 * 60 * 1000;
const { UPCOMING, PAST, CANCELLED } = FlightBookingGroup;

describe('FlightBookingsService my bookings (FLT-25)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let bookings: Model<FlightBooking>;
  let service: FlightBookingsService;
  const now = new Date();
  const me = new Types.ObjectId();
  const someoneElse = new Types.ObjectId();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-booking-list' })
      .asPromise();
    bookings = connection.model(
      FlightBooking.name,
      FlightBookingSchema,
    ) as unknown as Model<FlightBooking>;
    await bookings.syncIndexes();
    // Listing only reads bookings; flights, airlines and inventory are unused.
    service = new FlightBookingsService(
      bookings,
      null as never,
      null as never,
      null as never,
    );
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  afterEach(async () => {
    await bookings.deleteMany({});
  });

  /** A booking departing `hoursFromNow` hours from now. */
  function booking(
    status: FlightBookingStatus,
    hoursFromNow: number,
    extra: Partial<FlightBooking> = {},
  ) {
    const departureAt = new Date(now.getTime() + hoursFromNow * HOUR);
    const airlineId = new Types.ObjectId();
    return {
      userId: me,
      tripType: TripType.ONE_WAY,
      segments: [
        {
          direction: SegmentDirection.OUTBOUND,
          flightId: new Types.ObjectId(),
          airlineId,
          flightNumber: 'NA101',
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'LHR',
          departureAt,
          arrivalAt: new Date(departureAt.getTime() + 5 * HOUR),
          departureTimeZone: 'Africa/Cairo',
          arrivalTimeZone: 'Europe/London',
          cabinId: new Types.ObjectId(),
          cabinCategory: CabinCategory.ECONOMY,
          cabinFare: 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
          seats: 1,
          holdId: 'h',
        },
      ],
      passengers: [
        {
          fullName: 'Sara Hassan',
          dateOfBirth: new Date('1990-05-05'),
          documentNumber: 'A1234567',
          type: PassengerType.ADULT,
          fare: 200,
        },
      ],
      airlineId,
      departureAt,
      seats: 1,
      baseFare: 200,
      totalPrice: 200,
      status,
      holdExpiresAt: null,
      ...extra,
    };
  }

  const hold = (minutes: number) => ({
    holdExpiresAt: new Date(now.getTime() + minutes * 60_000),
  });

  /** One booking in every situation, keyed by the group it belongs in. */
  async function seedEveryState() {
    const docs = await bookings.create([
      booking(FlightBookingStatus.CONFIRMED, 48), // upcoming
      booking(FlightBookingStatus.PENDING_PAYMENT, 72, hold(5)), // upcoming
      booking(FlightBookingStatus.COMPLETED, -48), // past
      booking(FlightBookingStatus.CONFIRMED, -2), // past (cron not run yet)
      booking(FlightBookingStatus.CANCELLED, 24, {
        bookingReference: 'CANCEL',
        cancellationSource: CancellationSource.USER,
      }), // cancelled
      booking(FlightBookingStatus.EXPIRED, 24), // cancelled
      booking(FlightBookingStatus.PENDING_PAYMENT, 24, hold(-1)), // cancelled (hold ran out)
      { ...booking(FlightBookingStatus.CONFIRMED, 30), userId: someoneElse },
    ]);
    return docs.map((d) => d._id.toString());
  }

  it('puts every booking in exactly one group', async () => {
    const ids = await seedEveryState();
    const [upcoming, past, cancelled] = await Promise.all(
      [UPCOMING, PAST, CANCELLED].map((g) =>
        service.listMine(me.toString(), g, 1, now),
      ),
    );

    expect(upcoming.items.map((i) => i.id)).toEqual([ids[0], ids[1]]);
    expect(past.items.map((i) => i.id)).toEqual([ids[3], ids[2]]);
    expect(new Set(cancelled.items.map((i) => i.id))).toEqual(
      new Set([ids[4], ids[5], ids[6]]),
    );
    expect(upcoming.counts).toEqual({ upcoming: 2, past: 2, cancelled: 3 });
    expect(upcoming.total).toBe(2);
    expect(past.total).toBe(2);
    expect(cancelled.total).toBe(3);
  });

  it("never lists another user's bookings", async () => {
    const ids = await seedEveryState();
    const theirs = await service.listMine(
      someoneElse.toString(),
      UPCOMING,
      1,
      now,
    );
    expect(theirs.items.map((i) => i.id)).toEqual([ids[7]]);
    expect(theirs.counts).toEqual({ upcoming: 1, past: 0, cancelled: 0 });
  });

  it('shows reference, flight, date, passengers, cabin and status', async () => {
    await bookings.create(
      booking(FlightBookingStatus.CONFIRMED, 48, {
        bookingReference: 'K7QM2X',
      }),
    );
    const { items } = await service.listMine(me.toString(), UPCOMING, 1, now);
    expect(items[0]).toMatchObject({
      bookingReference: 'K7QM2X',
      status: 'Confirmed',
      tripType: 'one-way',
      passengers: [{ fullName: 'Sara Hassan', type: 'Adult' }],
      segments: [
        {
          flightNumber: 'NA101',
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'LHR',
          cabinCategory: 'Economy',
          departureLocalTime: expect.stringMatching(/\+02:00$/),
        },
      ],
    });
  });

  it('pages 10 at a time, soonest upcoming trip first', async () => {
    await bookings.create(
      Array.from({ length: 12 }, (_, i) =>
        booking(FlightBookingStatus.CONFIRMED, 100 - i),
      ),
    );

    const first = await service.listMine(me.toString(), UPCOMING, 1, now);
    const second = await service.listMine(me.toString(), UPCOMING, 2, now);

    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(2);
    expect(first).toMatchObject({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    const times = [...first.items, ...second.items].map((i) =>
      i.segments[0].departureAt.getTime(),
    );
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('rejects an invalid page', async () => {
    await expect(service.listMine(me.toString(), UPCOMING, 0)).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('details', () => {
    it('returns the full booking to its owner', async () => {
      const [doc] = await bookings.create([
        booking(FlightBookingStatus.CANCELLED, 24, {
          bookingReference: 'K7QM2X',
          cancelledAt: now,
          cancellationSource: CancellationSource.USER,
        }),
      ]);

      const details = await service.getMine(me.toString(), doc._id.toString());

      expect(details).toMatchObject({
        id: doc._id.toString(),
        status: 'Cancelled',
        bookingReference: 'K7QM2X',
        cancelledAt: now,
        cancellationSource: 'user',
        totalPrice: 200,
        passengers: [{ fullName: 'Sara Hassan', documentNumber: 'A1234567' }],
      });
      expect(details.passengers[0].id).toEqual(expect.any(String));
    });

    it("hides another user's booking as not found (ACC-11)", async () => {
      const [doc] = await bookings.create([
        { ...booking(FlightBookingStatus.CONFIRMED, 24), userId: someoneElse },
      ]);
      await expect(
        service.getMine(me.toString(), doc._id.toString()),
      ).rejects.toThrow(NotFoundException);
      await expect(service.getMine(me.toString(), 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
