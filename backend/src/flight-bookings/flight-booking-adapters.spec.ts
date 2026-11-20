import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { FlightInventoryService } from '../airlines/flight-inventory';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import {
  FlightInventoryHold,
  FlightInventoryHoldSchema,
} from '../airlines/schemas/flight-inventory-hold.schema';
import {
  CabinCategory,
  Flight,
  FlightSchema,
  FlightStatus,
} from '../airlines/schemas/flight.schema';
import { MongoBookingEligibilityReader } from '../integrations/booking-eligibility';
import type { NotificationsService } from '../notifications/notifications.service';
import { AirlineTierRefunds } from './airline-tier-refunds';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { PassengerType } from './flight-booking.constants';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingReaders } from './flight-booking-readers';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

jest.setTimeout(120_000);

describe('Flight booking adapters for Persons 1 and 3 (FLT-06, FLT-29, ACC-12)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;
  let holds: Model<FlightInventoryHold>;
  let bookings: Model<FlightBooking>;
  let booking: FlightBookingsService;
  let lifecycle: FlightBookingLifecycleService;
  let refunds: AirlineTierRefunds;
  let canceller: FlightBookingCancellationService;
  let readers: FlightBookingReaders;
  let eligibility: MongoBookingEligibilityReader;
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const sara = new Types.ObjectId().toString();
  const omar = new Types.ObjectId().toString();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-booking-adapters' })
      .asPromise();
    flights = connection.model(
      Flight.name,
      FlightSchema,
    ) as unknown as Model<Flight>;
    airlines = connection.model(
      Airline.name,
      AirlineSchema,
    ) as unknown as Model<Airline>;
    holds = connection.model(
      FlightInventoryHold.name,
      FlightInventoryHoldSchema,
    ) as unknown as Model<FlightInventoryHold>;
    bookings = connection.model(
      FlightBooking.name,
      FlightBookingSchema,
    ) as unknown as Model<FlightBooking>;
    await Promise.all([holds.syncIndexes(), bookings.syncIndexes()]);
    const inventory = new FlightInventoryService(flights, holds);
    const notify = notifications as unknown as NotificationsService;
    booking = new FlightBookingsService(bookings, flights, airlines, inventory);
    lifecycle = new FlightBookingLifecycleService(
      bookings,
      airlines,
      inventory,
      notify,
    );
    refunds = new AirlineTierRefunds(airlines);
    canceller = new FlightBookingCancellationService(
      bookings,
      airlines,
      inventory,
      refunds,
      notify,
    );
    readers = new FlightBookingReaders(bookings);
    eligibility = new MongoBookingEligibilityReader(connection);
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  beforeEach(() => {
    jest
      .spyOn(refunds, 'issueRefund')
      .mockResolvedValue({ refundId: 're_full', status: 'Pending' });
  });

  afterEach(async () => {
    notifications.send.mockClear();
    jest.restoreAllMocks();
    await Promise.all([
      flights.deleteMany({}),
      airlines.deleteMany({}),
      holds.deleteMany({}),
      bookings.deleteMany({}),
      connection.collection('hotelbookings').deleteMany({}),
    ]);
  });

  async function createFlight(
    airlineId: Types.ObjectId,
    options: { daysAhead: number; from?: string; to?: string; number?: string },
  ) {
    const departure = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: options.daysAhead })
      .set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
    return flights.create({
      airlineId,
      flightNumber: options.number ?? 'NA101',
      departureAirportCode: options.from ?? 'CAI',
      arrivalAirportCode: options.to ?? 'LHR',
      departureAt: departure.toUTC().toJSDate(),
      arrivalAt: departure.plus({ hours: 5 }).toUTC().toJSDate(),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Europe/London',
      departureLocalDate: departure.toISODate()!,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          seatCount: 10,
          price: 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
        },
      ],
    });
  }

  function dto(
    out: { _id: Types.ObjectId },
    doc: string,
    back?: { _id: Types.ObjectId },
  ): CreateFlightBookingDto {
    return {
      outbound: {
        flightId: out._id.toString(),
        cabinCategory: CabinCategory.ECONOMY,
      },
      ...(back && {
        returnFlight: {
          flightId: back._id.toString(),
          cabinCategory: CabinCategory.ECONOMY,
        },
      }),
      passengers: [
        {
          fullName: 'Sara Hassan',
          dateOfBirth: '1990-05-05',
          documentNumber: doc,
          type: PassengerType.ADULT,
        },
      ],
    };
  }

  /** Outbound CAI-LHR in 30 days, return LHR-CAI in 37 days. */
  async function routes() {
    const airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
    });
    const out = await createFlight(airline._id, { daysAhead: 30 });
    const back = await createFlight(airline._id, {
      daysAhead: 37,
      from: 'LHR',
      to: 'CAI',
      number: 'NA102',
    });
    return { out, back };
  }

  async function confirmedBooking(
    userId: string,
    doc: string,
    out: { _id: Types.ObjectId },
    back?: { _id: Types.ObjectId },
  ) {
    const held = await booking.hold(userId, dto(out, doc, back));
    await lifecycle.confirmBooking(held.id);
    return held.id;
  }

  async function seats(flightId: Types.ObjectId) {
    const flight = await flights.findById(flightId).lean().exec();
    const { seatsHeld, seatsBooked } = flight!.cabins[0];
    return { held: seatsHeld, booked: seatsBooked };
  }

  describe('cancelConfirmedBookings (FLT-06)', () => {
    it('cancels round trips as a whole at 100% and frees the other flight too', async () => {
      const { out, back } = await routes();
      const roundTrip = await confirmedBooking(sara, 'DOC00001', out, back);
      notifications.send.mockClear(); // confirmation's own BOOKING_CONFIRMED

      const affected = await canceller.cancelConfirmedBookings(
        back._id.toString(),
      );

      expect(affected).toEqual([sara]);
      expect(await bookings.findById(roundTrip).lean().exec()).toMatchObject({
        status: 'Cancelled',
        cancellationSource: 'flight-cancelled',
        refundPercentage: 100,
        refundAmount: 400,
        refundId: 're_full',
      });
      expect(await seats(out._id)).toEqual({ held: 0, booked: 0 });
      expect(await seats(back._id)).toEqual({ held: 0, booked: 0 });
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('expires unpaid holds and returns each affected user once', async () => {
      const { out } = await routes();
      await confirmedBooking(sara, 'DOC00001', out);
      await confirmedBooking(sara, 'DOC00002', out);
      const unpaid = await booking.hold(omar, dto(out, 'DOC00003'));

      const affected = await canceller.cancelConfirmedBookings(
        out._id.toString(),
      );

      expect(affected.sort()).toEqual([sara, omar].sort());
      expect((await bookings.findById(unpaid.id).lean().exec())!.status).toBe(
        'Expired',
      );
      expect(await seats(out._id)).toEqual({ held: 0, booked: 0 });
      // A payment arriving now is refused, so it cannot confirm a cancelled flight.
      await expect(lifecycle.confirmBooking(unpaid.id)).rejects.toThrow(
        /Expired booking cannot be confirmed/,
      );
    });

    it('leaves bookings on other flights and finished bookings alone', async () => {
      const { out, back } = await routes();
      const other = await confirmedBooking(sara, 'DOC00001', back);

      expect(
        await canceller.cancelConfirmedBookings(out._id.toString()),
      ).toEqual([]);
      expect((await bookings.findById(other).lean().exec())!.status).toBe(
        'Confirmed',
      );
      expect(refunds.issueRefund).not.toHaveBeenCalled();
    });
  });

  describe('readers for the flight module', () => {
    it('lists users with Confirmed bookings on a flight, once each (FLT-05)', async () => {
      const { out, back } = await routes();
      await confirmedBooking(sara, 'DOC00001', out, back);
      await confirmedBooking(sara, 'DOC00002', back);
      await booking.hold(omar, dto(back, 'DOC00003'));

      expect(
        await readers.findConfirmedPassengerIds(back._id.toString()),
      ).toEqual([sara]);
      expect(
        await readers.findConfirmedPassengerIds(out._id.toString()),
      ).toEqual([sara]);
    });

    it("lists a flight's bookings with that flight's cabin and seats (FLT-29)", async () => {
      const { out, back } = await routes();
      const roundTrip = await confirmedBooking(sara, 'DOC00001', out, back);
      await booking.hold(omar, dto(back, 'DOC00002'));

      const records = await readers.listByFlightId(back._id.toString());

      expect(records).toEqual([
        {
          id: roundTrip,
          bookingReference: expect.stringMatching(/^[A-Z2-9]{6}$/),
          passengers: [{ id: expect.any(String), name: 'Sara Hassan' }],
          cabin: 'Economy',
          seats: 1,
          status: 'Confirmed',
        },
      ]);
    });
  });

  describe('hasUpcomingConfirmedBookings (ACC-12)', () => {
    it('is false with no bookings and true with an upcoming Confirmed flight', async () => {
      const { out } = await routes();
      expect(await eligibility.hasUpcomingConfirmedBookings(sara)).toBe(false);

      await booking.hold(sara, dto(out, 'DOC00001'));
      expect(await eligibility.hasUpcomingConfirmedBookings(sara)).toBe(false);

      await confirmedBooking(sara, 'DOC00002', out);
      expect(await eligibility.hasUpcomingConfirmedBookings(sara)).toBe(true);
      expect(await eligibility.hasUpcomingConfirmedBookings(omar)).toBe(false);
    });

    it('still counts a round trip whose outbound flight has departed', async () => {
      const { out, back } = await routes();
      await confirmedBooking(sara, 'DOC00001', out, back);
      const between = new Date(
        (out.departureAt.getTime() + back.departureAt.getTime()) / 2,
      );
      const afterReturn = new Date(back.departureAt.getTime() + 1000);

      expect(
        await eligibility.hasUpcomingConfirmedBookings(sara, between),
      ).toBe(true);
      expect(
        await eligibility.hasUpcomingConfirmedBookings(sara, afterReturn),
      ).toBe(false);
    });

    it('also counts upcoming Confirmed hotel bookings (Person 6 contract)', async () => {
      await connection.collection('hotelbookings').insertOne({
        userId: new Types.ObjectId(sara),
        status: 'Confirmed',
        checkInDate: new Date(Date.now() + 86_400_000),
      });
      expect(await eligibility.hasUpcomingConfirmedBookings(sara)).toBe(true);
    });
  });
});
