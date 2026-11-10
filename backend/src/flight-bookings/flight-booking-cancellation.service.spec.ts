import { ConflictException, NotFoundException } from '@nestjs/common';
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
import { NotificationType } from '../notifications/notification.constants';
import type { NotificationsService } from '../notifications/notifications.service';
import {
  AirlineTierRefunds,
  daysBeforeDeparture,
} from './airline-tier-refunds';
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { CancellationSource, PassengerType } from './flight-booking.constants';
import { FlightBookingCancellationService } from './flight-booking-cancellation.service';
import { FlightBookingLifecycleService } from './flight-booking-lifecycle.service';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

jest.setTimeout(120_000);

const TIERS = [
  { daysBeforeDeparture: 30, refundPercentage: 100 },
  { daysBeforeDeparture: 7, refundPercentage: 50 },
  { daysBeforeDeparture: 0, refundPercentage: 0 },
];

describe('FlightBookingCancellationService (FLT-26, PAY-03)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;
  let holds: Model<FlightInventoryHold>;
  let bookings: Model<FlightBooking>;
  let booking: FlightBookingsService;
  let lifecycle: FlightBookingLifecycleService;
  let refunds: AirlineTierRefunds;
  let cancellation: FlightBookingCancellationService;
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-booking-cancel' })
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
    cancellation = new FlightBookingCancellationService(
      bookings,
      airlines,
      inventory,
      refunds,
      notify,
    );
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  beforeEach(() => {
    jest.spyOn(refunds, 'issueRefund').mockResolvedValue({
      refundId: 're_test_1',
      status: 'Pending',
    });
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

  function request(
    out: { _id: Types.ObjectId },
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
          documentNumber: 'A1234567',
          type: PassengerType.ADULT,
        },
      ],
    };
  }

  /** A Confirmed one-way booking `daysAhead` days out (or a round trip). */
  async function confirmed(daysAhead = 12, returnDaysAhead?: number) {
    const airline = await airlines.create({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
      cancellationPolicy: TIERS,
    });
    const out = await createFlight(airline._id, { daysAhead });
    const back = returnDaysAhead
      ? await createFlight(airline._id, {
          daysAhead: returnDaysAhead,
          from: 'LHR',
          to: 'CAI',
          number: 'NA102',
        })
      : undefined;
    const held = await booking.hold(userId, request(out, back));
    await lifecycle.confirmBooking(held.id);
    notifications.send.mockClear();
    return { id: held.id, out, back };
  }

  async function seats(flightId: Types.ObjectId) {
    const flight = await flights.findById(flightId).lean().exec();
    const { seatsHeld, seatsBooked } = flight!.cabins[0];
    return { held: seatsHeld, booked: seatsBooked };
  }

  describe('refund preview', () => {
    it("uses the airline's tier for the days left and changes nothing", async () => {
      const { id, out } = await confirmed(12);

      const preview = await cancellation.previewRefund(userId, id);

      expect(preview).toMatchObject({
        bookingId: id,
        totalPrice: 200,
        currency: 'USD',
        refundPercentage: 50,
        refundAmount: 100,
      });
      expect(preview.bookingReference).toEqual(expect.any(String));
      expect([11, 12]).toContain(preview.daysBeforeDeparture);
      expect((await bookings.findById(id).lean().exec())!.status).toBe(
        'Confirmed',
      );
      expect(await seats(out._id)).toEqual({ held: 0, booked: 1 });
    });

    it('applies the outbound tier to the whole round-trip total (FLT-12)', async () => {
      const { id } = await confirmed(12, 40);
      await expect(
        cancellation.previewRefund(userId, id),
      ).resolves.toMatchObject({
        totalPrice: 400,
        refundPercentage: 50,
        refundAmount: 200,
      });
    });
  });

  describe('cancel', () => {
    it('cancels, returns the seats, requests the refund and notifies', async () => {
      const { id, out } = await confirmed(12);

      const result = await cancellation.cancel(userId, id, {
        confirm: true,
        expectedRefundAmount: 100,
      });

      expect(result.booking).toMatchObject({
        status: 'Cancelled',
        cancellationSource: CancellationSource.USER,
        refundPercentage: 50,
        refundAmount: 100,
        refundId: 're_test_1',
      });
      expect(result.booking.cancelledAt).toBeInstanceOf(Date);
      expect(result.refund).toEqual({
        refundPercentage: 50,
        refundAmount: 100,
        currency: 'USD',
        refundId: 're_test_1',
        status: 'Pending',
      });
      expect(await seats(out._id)).toEqual({ held: 0, booked: 0 });
      expect(refunds.issueRefund).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: id,
          userId,
          totalPrice: 200,
          source: CancellationSource.USER,
        }),
        expect.objectContaining({ refundAmount: 100, refundPercentage: 50 }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        userId,
        NotificationType.BOOKING_CANCELLED,
        expect.objectContaining({
          bookingId: id,
          bookingType: 'flight',
          bookingReference: result.booking.bookingReference,
          providerName: 'Nile Air',
        }),
      );
    });

    it('frees both flights of a round trip', async () => {
      const { id, out, back } = await confirmed(12, 40);
      await cancellation.cancel(userId, id, { confirm: true });
      expect(await seats(out._id)).toEqual({ held: 0, booked: 0 });
      expect(await seats(back!._id)).toEqual({ held: 0, booked: 0 });
    });

    it('cancels without a refund request when the tier gives 0%', async () => {
      const { id } = await confirmed(3);

      const result = await cancellation.cancel(userId, id, { confirm: true });

      expect(result.refund).toMatchObject({
        refundAmount: 0,
        refundId: null,
        status: null,
      });
      expect(result.booking.status).toBe('Cancelled');
      expect(refunds.issueRefund).not.toHaveBeenCalled();
    });

    it('refuses when the refund changed since the preview', async () => {
      const { id, out } = await confirmed(12);
      await expect(
        cancellation.cancel(userId, id, {
          confirm: true,
          expectedRefundAmount: 200,
        }),
      ).rejects.toThrow(/refund is now 100 USD, not 200/);
      expect((await bookings.findById(id).lean().exec())!.status).toBe(
        'Confirmed',
      );
      expect(await seats(out._id)).toEqual({ held: 0, booked: 1 });
    });

    it('cancels once under concurrent requests', async () => {
      const { id, out } = await confirmed(12);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          cancellation.cancel(userId, id, { confirm: true }),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await seats(out._id)).toEqual({ held: 0, booked: 0 });
      expect(refunds.issueRefund).toHaveBeenCalledTimes(1);
      expect(notifications.send).toHaveBeenCalledTimes(1);
    });

    it('keeps the cancellation when issuing the refund fails', async () => {
      const { id } = await confirmed(12);
      jest
        .spyOn(refunds, 'issueRefund')
        .mockRejectedValue(new Error('stripe down'));

      const result = await cancellation.cancel(userId, id, { confirm: true });

      expect(result.booking.status).toBe('Cancelled');
      expect(result.refund).toMatchObject({
        refundAmount: 100,
        status: 'Failed',
      });
    });
  });

  describe('rejections', () => {
    it('refuses a booking that is not Confirmed', async () => {
      const airline = await airlines.create({
        name: 'Nile Air',
        code: 'NA',
        isActive: true,
      });
      const flight = await createFlight(airline._id, { daysAhead: 12 });
      const held = await booking.hold(userId, request(flight));

      await expect(cancellation.previewRefund(userId, held.id)).rejects.toThrow(
        /Only Confirmed bookings can be cancelled; this booking is Pending Payment/,
      );
      await expect(
        cancellation.cancel(userId, held.id, { confirm: true }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses a second cancellation', async () => {
      const { id } = await confirmed(12);
      await cancellation.cancel(userId, id, { confirm: true });
      await expect(
        cancellation.cancel(userId, id, { confirm: true }),
      ).rejects.toThrow(/this booking is Cancelled/);
    });

    it('refuses after departure', async () => {
      const { id } = await confirmed(12);
      await bookings.updateOne(
        { _id: id },
        { departureAt: new Date(Date.now() - 60_000) },
      );
      await expect(
        cancellation.cancel(userId, id, { confirm: true }),
      ).rejects.toThrow(/after departure/);
    });

    it("hides another user's booking (ACC-11)", async () => {
      const { id } = await confirmed(12);
      const stranger = new Types.ObjectId().toString();
      await expect(cancellation.previewRefund(stranger, id)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        cancellation.cancel(stranger, id, { confirm: true }),
      ).rejects.toThrow(NotFoundException);
      expect((await bookings.findById(id).lean().exec())!.status).toBe(
        'Confirmed',
      );
    });
  });

  describe('AirlineTierRefunds (default until Person 7 binds payments)', () => {
    const base = {
      bookingId: 'b',
      userId: 'u',
      bookingReference: null,
      departureAt: new Date('2030-01-31T08:00:00Z'),
      totalPrice: 333.33,
      currency: 'USD',
    };

    it('refunds 100% for an airline cancellation (FLT-06)', async () => {
      const airline = await airlines.create({
        name: 'Nile Air',
        code: 'NA',
        isActive: true,
        cancellationPolicy: TIERS,
      });
      await expect(
        refunds.previewRefund(
          {
            ...base,
            airlineId: airline._id.toString(),
            source: CancellationSource.FLIGHT_CANCELLED,
          },
          new Date('2030-01-30T08:00:00Z'),
        ),
      ).resolves.toMatchObject({ refundPercentage: 100, refundAmount: 333.33 });
    });

    it('refunds 0% when the airline has no tiers, and rounds to cents', async () => {
      const bare = await airlines.create({
        name: 'Bare Air',
        code: 'BA',
        isActive: true,
      });
      const tiered = await airlines.create({
        name: 'Nile Air',
        code: 'NA',
        isActive: true,
        cancellationPolicy: TIERS,
      });
      const at = new Date('2030-01-21T08:00:00Z');
      await expect(
        refunds.previewRefund(
          {
            ...base,
            airlineId: bare._id.toString(),
            source: CancellationSource.USER,
          },
          at,
        ),
      ).resolves.toMatchObject({ refundPercentage: 0, refundAmount: 0 });
      await expect(
        refunds.previewRefund(
          {
            ...base,
            airlineId: tiered._id.toString(),
            source: CancellationSource.USER,
          },
          at,
        ),
      ).resolves.toMatchObject({
        daysBeforeDeparture: 10,
        refundAmount: 166.67,
      });
    });

    it('counts whole days before departure', () => {
      const departure = new Date('2030-01-31T08:00:00Z');
      expect(
        daysBeforeDeparture(departure, new Date('2030-01-24T08:00:00Z')),
      ).toBe(7);
      expect(
        daysBeforeDeparture(departure, new Date('2030-01-24T08:00:01Z')),
      ).toBe(6);
      expect(
        daysBeforeDeparture(departure, new Date('2030-02-01T00:00:00Z')),
      ).toBe(0);
    });
  });
});
