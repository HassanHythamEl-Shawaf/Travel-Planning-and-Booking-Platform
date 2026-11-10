import { ConflictException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { FlightInventoryService } from '../airlines/flight-inventory';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import {
  FlightInventoryHold,
  FlightInventoryHoldSchema,
  InventoryHoldStatus,
} from '../airlines/schemas/flight-inventory-hold.schema';
import {
  CabinCategory,
  Flight,
  FlightSchema,
  FlightStatus,
} from '../airlines/schemas/flight.schema';
import { NotificationType } from '../notifications/notification.constants';
import type { NotificationsService } from '../notifications/notifications.service';
import { isBookingReference } from './booking-reference';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { PassengerType } from './flight-booking.constants';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

jest.setTimeout(120_000);

describe('FlightBookingLifecycleService (FLT-22, FLT-23, GEN-11)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;
  let holds: Model<FlightInventoryHold>;
  let bookings: Model<FlightBooking>;
  let booking: FlightBookingsService;
  let lifecycle: FlightBookingLifecycleService;
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-booking-lifecycle' })
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
    booking = new FlightBookingsService(bookings, flights, airlines, inventory);
    lifecycle = new FlightBookingLifecycleService(
      bookings,
      airlines,
      inventory,
      notifications as unknown as NotificationsService,
    );
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  afterEach(async () => {
    notifications.send.mockClear();
    jest.restoreAllMocks();
    await Promise.all([
      flights.deleteMany({}),
      airlines.deleteMany({}),
      holds.deleteMany({}),
      bookings.deleteMany({}),
    ]);
  });

  async function createFlight(
    airlineId: Types.ObjectId,
    options: {
      from?: string;
      to?: string;
      daysAhead?: number;
      number?: string;
    } = {},
  ) {
    const departure = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: options.daysAhead ?? 30 })
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
    outbound: { _id: Types.ObjectId },
    returnFlight?: { _id: Types.ObjectId },
  ): CreateFlightBookingDto {
    return {
      outbound: {
        flightId: outbound._id.toString(),
        cabinCategory: CabinCategory.ECONOMY,
      },
      ...(returnFlight && {
        returnFlight: {
          flightId: returnFlight._id.toString(),
          cabinCategory: CabinCategory.ECONOMY,
        },
      }),
      passengers: [
        {
          fullName: 'Sara Hassan',
          dateOfBirth: '1990-05-05',
          documentNumber: 'A1234567',
          type: PassengerType.ADULT,
        },
        {
          fullName: 'Omar Hassan',
          dateOfBirth: '1992-07-07',
          documentNumber: 'B7654321',
          type: PassengerType.ADULT,
        },
      ],
    };
  }

  /** A held round trip (2 seats on each of two flights). */
  async function heldRoundTrip() {
    const airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
    });
    const out = await createFlight(airline._id);
    const back = await createFlight(airline._id, {
      daysAhead: 37,
      from: 'LHR',
      to: 'CAI',
      number: 'NA102',
    });
    const held = await booking.hold(userId, dto(out, back));
    return { held, out, back };
  }

  async function cabin(flightId: Types.ObjectId) {
    const flight = await flights.findById(flightId).lean().exec();
    const { seatsHeld, seatsBooked } = flight!.cabins[0];
    return { held: seatsHeld, booked: seatsBooked };
  }

  async function expire(bookingId: string) {
    await bookings.updateOne(
      { _id: bookingId },
      { holdExpiresAt: new Date(Date.now() - 1000) },
    );
  }

  describe('confirmBooking (FLT-23)', () => {
    it('books the held seats, issues a reference and notifies the user', async () => {
      const { held, out, back } = await heldRoundTrip();

      const result = await lifecycle.confirmBooking(held.id);

      expect(result.newlyConfirmed).toBe(true);
      expect(isBookingReference(result.bookingReference)).toBe(true);
      const stored = await bookings.findById(held.id).lean().exec();
      expect(stored).toMatchObject({
        status: 'Confirmed',
        bookingReference: result.bookingReference,
        holdExpiresAt: null,
      });
      expect(stored!.confirmedAt).toBeInstanceOf(Date);
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 2 });
      expect(await cabin(back._id)).toEqual({ held: 0, booked: 2 });
      expect(notifications.send).toHaveBeenCalledWith(
        userId,
        NotificationType.BOOKING_CONFIRMED,
        {
          bookingId: held.id,
          bookingType: 'flight',
          bookingReference: result.bookingReference,
          providerName: 'Nile Air',
        },
      );
    });

    it('is idempotent for a repeated webhook', async () => {
      const { held, out } = await heldRoundTrip();
      const first = await lifecycle.confirmBooking(held.id);

      const second = await lifecycle.confirmBooking(held.id);

      expect(second).toEqual({ ...first, newlyConfirmed: false });
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 2 });
      expect(notifications.send).toHaveBeenCalledTimes(1);
    });

    it('confirms once under concurrent calls', async () => {
      const { held, out } = await heldRoundTrip();

      const results = await Promise.all(
        Array.from({ length: 5 }, () => lifecycle.confirmBooking(held.id)),
      );

      expect(results.filter((r) => r.newlyConfirmed)).toHaveLength(1);
      expect(new Set(results.map((r) => r.bookingReference)).size).toBe(1);
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 2 });
    });

    it('refuses a booking whose hold has expired', async () => {
      const { held, out } = await heldRoundTrip();
      await expire(held.id);

      await expect(lifecycle.confirmBooking(held.id)).rejects.toThrow(
        /hold has expired/,
      );
      expect(await cabin(out._id)).toEqual({ held: 2, booked: 0 });
      expect((await bookings.findById(held.id).lean().exec())!.status).toBe(
        'Pending Payment',
      );
    });

    it('refuses an Expired booking and an unknown id', async () => {
      const { held } = await heldRoundTrip();
      await expire(held.id);
      await lifecycle.releaseHold(held.id);

      await expect(lifecycle.confirmBooking(held.id)).rejects.toThrow(
        /Expired booking cannot be confirmed/,
      );
      await expect(
        lifecycle.confirmBooking(new Types.ObjectId().toString()),
      ).rejects.toThrow(NotFoundException);
      await expect(lifecycle.confirmBooking('not-an-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('retries with a new reference when one is already taken', async () => {
      const { held } = await heldRoundTrip();
      await bookings.collection.insertOne({ bookingReference: 'AAAAAA' });
      jest
        .spyOn(
          lifecycle as unknown as { newReference(): string },
          'newReference',
        )
        .mockReturnValueOnce('AAAAAA')
        .mockReturnValueOnce('BBBBBB');

      const result = await lifecycle.confirmBooking(held.id);

      expect(result.bookingReference).toBe('BBBBBB');
    });

    it('rolls the booking back to Pending Payment if inventory cannot be confirmed', async () => {
      const { held } = await heldRoundTrip();
      await holds.updateMany({}, { status: InventoryHoldStatus.RELEASED });

      await expect(lifecycle.confirmBooking(held.id)).rejects.toThrow(
        ConflictException,
      );
      const stored = await bookings.findById(held.id).lean().exec();
      expect(stored).toMatchObject({
        status: 'Pending Payment',
        bookingReference: null,
        confirmedAt: null,
      });
      expect(stored!.holdExpiresAt).toEqual(held.holdExpiresAt);
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  describe('releaseHold (FLT-22)', () => {
    it('expires the booking, frees the seats and notifies the user', async () => {
      const { held, out, back } = await heldRoundTrip();
      await expire(held.id);

      expect(await lifecycle.releaseHold(held.id)).toBe(true);

      const stored = await bookings.findById(held.id).lean().exec();
      expect(stored).toMatchObject({ status: 'Expired', holdExpiresAt: null });
      expect(stored!.expiredAt).toBeInstanceOf(Date);
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 0 });
      expect(await cabin(back._id)).toEqual({ held: 0, booked: 0 });
      expect(notifications.send).toHaveBeenCalledWith(
        userId,
        NotificationType.BOOKING_EXPIRED,
        { bookingId: held.id, bookingType: 'flight', providerName: 'Nile Air' },
      );
    });

    it('is idempotent', async () => {
      const { held, out } = await heldRoundTrip();
      await expire(held.id);
      await lifecycle.releaseHold(held.id);

      expect(await lifecycle.releaseHold(held.id)).toBe(false);
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 0 });
      expect(notifications.send).toHaveBeenCalledTimes(1);
    });

    it('never touches a confirmed booking', async () => {
      const { held, out } = await heldRoundTrip();
      await lifecycle.confirmBooking(held.id);

      expect(await lifecycle.releaseHold(held.id)).toBe(false);
      expect(await cabin(out._id)).toEqual({ held: 0, booked: 2 });
    });

    it('refuses to release a hold that is still running', async () => {
      const { held, out } = await heldRoundTrip();
      await expect(lifecycle.releaseHold(held.id)).rejects.toThrow(
        /has not expired yet/,
      );
      expect(await cabin(out._id)).toEqual({ held: 2, booked: 0 });
    });
  });

  describe('expiry job helpers (Person 7 ExpiryService)', () => {
    it('releases only expired holds', async () => {
      const airline = await airlines.create({
        name: 'Nile Air',
        code: 'NA',
        isActive: true,
      });
      const flight = await createFlight(airline._id);
      const make = async (doc: string) =>
        booking.hold(userId, {
          ...dto(flight),
          passengers: [{ ...dto(flight).passengers[0], documentNumber: doc }],
        });
      const [a, b, active] = [
        await make('D0000001'),
        await make('D0000002'),
        await make('D0000003'),
      ];
      await expire(a.id);
      await expire(b.id);

      expect(await lifecycle.releaseExpiredHolds()).toBe(2);
      expect((await bookings.findById(active.id).lean().exec())!.status).toBe(
        'Pending Payment',
      );
      expect(await cabin(flight._id)).toEqual({ held: 1, booked: 0 });
    });

    it('completes confirmed bookings once every flight has departed (GEN-11)', async () => {
      const { held } = await heldRoundTrip();
      await lifecycle.confirmBooking(held.id);
      const stored = await bookings.findById(held.id).lean().exec();
      const outboundGone = new Date(
        stored!.segments[0].departureAt.getTime() + 1000,
      );
      const returnGone = new Date(
        stored!.segments[1].departureAt.getTime() + 1000,
      );

      expect(await lifecycle.completeDepartedBookings(outboundGone)).toBe(0);
      expect(await lifecycle.completeDepartedBookings(returnGone)).toBe(1);
      expect(await bookings.findById(held.id).lean().exec()).toMatchObject({
        status: 'Completed',
        completedAt: returnGone,
      });
    });
  });

  it('exposes the amount and owner for payment (PAY-01)', async () => {
    const { held } = await heldRoundTrip();
    await expect(lifecycle.getForPayment(held.id)).resolves.toEqual({
      id: held.id,
      userId,
      status: 'Pending Payment',
      totalPrice: 800,
      currency: 'USD',
      holdExpiresAt: held.holdExpiresAt,
    });
  });
});
