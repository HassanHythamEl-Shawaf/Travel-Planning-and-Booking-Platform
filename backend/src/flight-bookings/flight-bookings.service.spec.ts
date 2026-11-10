import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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
import { CreateFlightBookingDto } from './dto/create-flight-booking.dto';
import { PassengerType } from './flight-booking.constants';
import { FlightBookingsService } from './flight-bookings.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

jest.setTimeout(120_000);


describe('FlightBookingsService quote and hold (FLT-19, FLT-21, FLT-22)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let flights: Model<Flight>;
  let airlines: Model<Airline>;
  let holds: Model<FlightInventoryHold>;
  let bookings: Model<FlightBooking>;
  let service: FlightBookingsService;
  const userId = new Types.ObjectId().toString();

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-booking-hold' })
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
    service = new FlightBookingsService(bookings, flights, airlines, inventory);
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  afterEach(async () => {
    await Promise.all([
      flights.deleteMany({}),
      airlines.deleteMany({}),
      holds.deleteMany({}),
      bookings.deleteMany({}),
    ]);
  });

  async function createAirline(overrides: Partial<Airline> = {}) {
    return airlines.create({
      name: 'Nile Air',
      code: `N${Math.floor(Math.random() * 1e6)}`,
      isActive: true,
      baggagePolicy: { pricePerExtraBag: 50, maxExtraBagsPerPassenger: 2 },
      cancellationPolicy: [],
      ...overrides,
    });
  }

  /** A Scheduled flight `daysAhead` days out, departing 08:00 Cairo time. */
  async function createFlight(
    airlineId: Types.ObjectId,
    options: {
      from?: string;
      to?: string;
      daysAhead?: number;
      seats?: number;
      price?: number;
      status?: FlightStatus;
      number?: string;
    } = {},
  ) {
    const departureLocal = DateTime.now()
      .setZone('Africa/Cairo')
      .plus({ days: options.daysAhead ?? 30 })
      .set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
    return flights.create({
      airlineId,
      flightNumber: options.number ?? 'NA101',
      departureAirportCode: options.from ?? 'CAI',
      arrivalAirportCode: options.to ?? 'LHR',
      departureAt: departureLocal.toUTC().toJSDate(),
      arrivalAt: departureLocal.plus({ hours: 5 }).toUTC().toJSDate(),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Europe/London',
      departureLocalDate: departureLocal.toISODate(),
      status: options.status ?? FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          seatCount: options.seats ?? 10,
          price: options.price ?? 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
        },
      ],
    });
  }

  /** A date of birth that makes the passenger `years` old on `flight`'s date. */
  function bornYearsBefore(
    flight: { departureLocalDate: string },
    years: number,
  ) {
    return DateTime.fromISO(flight.departureLocalDate)
      .minus({ years, days: 1 })
      .toISODate()!;
  }

  function request(
    flight: { _id: Types.ObjectId; departureLocalDate: string },
    overrides: Partial<CreateFlightBookingDto> = {},
  ): CreateFlightBookingDto {
    return {
      outbound: {
        flightId: flight._id.toString(),
        cabinCategory: CabinCategory.ECONOMY,
      },
      passengers: [
        {
          fullName: 'Sara Hassan',
          dateOfBirth: bornYearsBefore(flight, 30),
          documentNumber: 'A1234567',
          type: PassengerType.ADULT,
        },
      ],
      ...overrides,
    };
  }

  async function cabinCounters(flightId: Types.ObjectId) {
    const flight = await flights.findById(flightId).lean().exec();
    const cabin = flight!.cabins[0];
    return { held: cabin.seatsHeld, booked: cabin.seatsBooked };
  }

  describe('summary (POST /flight-bookings)', () => {
    it('prices adults, children, infants and extra bags without saving', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id, { price: 199.99 });

      const summary = await service.quote(
        request(flight, {
          passengers: [
            {
              fullName: 'Sara Hassan',
              dateOfBirth: bornYearsBefore(flight, 30),
              documentNumber: 'a1',
              type: PassengerType.ADULT,
              extraBags: 2,
              extraBaggageWeightKg: 40,
            },
            {
              fullName: 'Omar Hassan',
              dateOfBirth: bornYearsBefore(flight, 7),
              documentNumber: 'a2',
              type: PassengerType.CHILD,
            },
            {
              fullName: 'Laila Hassan',
              dateOfBirth: bornYearsBefore(flight, 1),
              documentNumber: 'a3',
              type: PassengerType.INFANT,
            },
          ].map((p) => ({ ...p, documentNumber: `${p.documentNumber}XYZ` })),
        }),
      );

      expect(summary.tripType).toBe('one-way');
      expect(summary.seats).toBe(2);
      expect(summary.passengers.map((p) => p.fare)).toEqual([
        199.99, 199.99, 20,
      ]);
      expect(summary.baseFare).toBe(419.98);
      expect(summary.baggageFees).toBe(100);
      expect(summary.totalPrice).toBe(519.98);
      expect(summary.currency).toBe('USD');
      expect(summary.segments[0].departureLocalTime).toMatch(
        /T08:00:00\+02:00$/,
      );
      expect(await bookings.countDocuments()).toBe(0);
      expect(await cabinCounters(flight._id)).toEqual({ held: 0, booked: 0 });
    });

    it('reports when there are not enough seats', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id, { seats: 1 });
      const dto = request(flight, {
        passengers: [
          request(flight).passengers[0],
          { ...request(flight).passengers[0], documentNumber: 'B7654321' },
        ],
      });
      await expect(service.quote(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('hold (POST /flight-bookings/hold)', () => {
    it('holds seats and stores a Pending Payment booking for 10 minutes', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const before = Date.now();

      const booking = await service.hold(userId, request(flight));

      expect(booking.status).toBe('Pending Payment');
      expect(booking.bookingReference).toBeNull();
      const holdMs = booking.holdExpiresAt!.getTime() - before;
      expect(holdMs).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
      expect(holdMs).toBeLessThanOrEqual(10 * 60_000 + 5000);
      expect(await cabinCounters(flight._id)).toEqual({ held: 1, booked: 0 });

      const stored = await bookings.findById(booking.id).lean().exec();
      expect(stored!.userId.toString()).toBe(userId);
      expect(stored!.airlineId.toString()).toBe(airline._id.toString());
      expect(stored!.departureAt).toEqual(flight.departureAt);
      expect(stored!.segments[0].holdId).toEqual(expect.any(String));
      expect(
        await holds.countDocuments({ status: InventoryHoldStatus.HELD }),
      ).toBe(1);
    });

    it('books a round trip as one booking with two held segments', async () => {
      const airline = await createAirline();
      const out = await createFlight(airline._id, { daysAhead: 30 });
      const back = await createFlight(airline._id, {
        daysAhead: 37,
        from: 'LHR',
        to: 'CAI',
        number: 'NA102',
      });

      const booking = await service.hold(
        userId,
        request(out, {
          returnFlight: {
            flightId: back._id.toString(),
            cabinCategory: CabinCategory.ECONOMY,
          },
        }),
      );

      expect(booking.tripType).toBe('round-trip');
      expect(booking.segments.map((s) => s.direction)).toEqual([
        'outbound',
        'return',
      ]);
      expect(booking.totalPrice).toBe(400);
      expect(await cabinCounters(out._id)).toEqual({ held: 1, booked: 0 });
      expect(await cabinCounters(back._id)).toEqual({ held: 1, booked: 0 });
    });

    it('releases the outbound hold when the return flight is full', async () => {
      const airline = await createAirline();
      const out = await createFlight(airline._id, { daysAhead: 30 });
      const back = await createFlight(airline._id, {
        daysAhead: 37,
        from: 'LHR',
        to: 'CAI',
        number: 'NA102',
        seats: 1,
      });
      await service.hold(
        userId,
        request(back, {
          passengers: [
            { ...request(back).passengers[0], documentNumber: 'C1111111' },
          ],
        }),
      );

      await expect(
        service.hold(
          userId,
          request(out, {
            returnFlight: {
              flightId: back._id.toString(),
              cabinCategory: CabinCategory.ECONOMY,
            },
          }),
        ),
      ).rejects.toThrow(/Not enough Economy seats left on flight NA102/);

      expect(await cabinCounters(out._id)).toEqual({ held: 0, booked: 0 });
      expect(await bookings.countDocuments()).toBe(1);
    });

    it('never holds more seats than exist under parallel requests', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id, { seats: 5 });

      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          service.hold(
            new Types.ObjectId().toString(),
            request(flight, {
              passengers: [
                {
                  ...request(flight).passengers[0],
                  documentNumber: `P${1000 + i}`,
                },
              ],
            }),
          ),
        ),
      );

      const won = results.filter((r) => r.status === 'fulfilled');
      const lost = results.filter((r) => r.status === 'rejected');
      expect(won).toHaveLength(5);
      expect(lost).toHaveLength(15);
      for (const r of lost) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          ConflictException,
        );
      }
      expect(await cabinCounters(flight._id)).toEqual({ held: 5, booked: 0 });
      expect(await bookings.countDocuments()).toBe(5);
      expect(
        await holds.countDocuments({ status: InventoryHoldStatus.HELD }),
      ).toBe(5);
    });

    it('gives infants no seat', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id, { seats: 1 });
      const booking = await service.hold(
        userId,
        request(flight, {
          passengers: [
            request(flight).passengers[0],
            {
              fullName: 'Baby Hassan',
              dateOfBirth: bornYearsBefore(flight, 0),
              documentNumber: 'INF00001',
              type: PassengerType.INFANT,
            },
          ],
        }),
      );
      expect(booking.seats).toBe(1);
      expect(await cabinCounters(flight._id)).toEqual({ held: 1, booked: 0 });
    });
  });

  describe('rejections', () => {
    it('rejects a deactivated airline (ACC-15)', async () => {
      const airline = await createAirline({ isActive: false });
      const flight = await createFlight(airline._id);
      await expect(service.hold(userId, request(flight))).rejects.toThrow(
        /not accepting new bookings/,
      );
      expect(await cabinCounters(flight._id)).toEqual({ held: 0, booked: 0 });
    });

    it.each([
      ['cancelled', { status: FlightStatus.CANCELLED }],
      ['departed', { daysAhead: -1 }],
    ])('rejects a %s flight (FLT-30)', async (_label, options) => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id, options);
      await expect(service.hold(userId, request(flight))).rejects.toThrow(
        /no longer open for booking/,
      );
    });

    it('rejects an unknown flight or missing cabin', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      await expect(
        service.quote(
          request({
            _id: new Types.ObjectId(),
            departureLocalDate: flight.departureLocalDate,
          }),
        ),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.quote({
          ...request(flight),
          outbound: {
            flightId: flight._id.toString(),
            cabinCategory: CabinCategory.FIRST,
          },
        }),
      ).rejects.toThrow(/has no First cabin/);
    });

    it('rejects a passenger type that does not match the date of birth', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const dto = request(flight, {
        passengers: [
          {
            ...request(flight).passengers[0],
            dateOfBirth: bornYearsBefore(flight, 11),
          },
        ],
      });
      await expect(service.quote(dto)).rejects.toThrow(
        /is 11 on .* so the passenger type must be Child, not Adult/,
      );
    });

    it('rejects a date of birth after the travel date', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const dto = request(flight, {
        passengers: [
          { ...request(flight).passengers[0], dateOfBirth: '2999-01-01' },
        ],
      });
      await expect(service.quote(dto)).rejects.toThrow(
        /date of birth must be a real date/,
      );
    });

    it('enforces at least one adult and no more infants than adults', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const adult = request(flight).passengers[0];
      const infant = (n: number) => ({
        fullName: `Infant ${n}`,
        dateOfBirth: bornYearsBefore(flight, 1),
        documentNumber: `INF0000${n}`,
        type: PassengerType.INFANT,
      });
      await expect(
        service.quote(request(flight, { passengers: [infant(1)] })),
      ).rejects.toThrow(/at least one adult/);
      await expect(
        service.quote(
          request(flight, { passengers: [adult, infant(1), infant(2)] }),
        ),
      ).rejects.toThrow(/more infants than adults/);
    });

    it('rejects a document number used twice', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const adult = request(flight).passengers[0];
      await expect(
        service.quote(
          request(flight, {
            passengers: [
              adult,
              { ...adult, fullName: 'Other', documentNumber: 'a1234567' },
            ],
          }),
        ),
      ).rejects.toThrow(/used for more than one passenger/);
    });

    it('enforces the extra-bag limit and weight per bag (FLT-08, FLT-19)', async () => {
      const airline = await createAirline();
      const flight = await createFlight(airline._id);
      const adult = request(flight).passengers[0];
      await expect(
        service.quote(
          request(flight, { passengers: [{ ...adult, extraBags: 3 }] }),
        ),
      ).rejects.toThrow(/at most 2 extra bag/);
      await expect(
        service.quote(
          request(flight, {
            passengers: [{ ...adult, extraBags: 1, extraBaggageWeightKg: 24 }],
          }),
        ),
      ).rejects.toThrow(/at most 23 kg/);
      await expect(
        service.quote(
          request(flight, {
            passengers: [{ ...adult, extraBaggageWeightKg: 5 }],
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows no extra bags when the airline has no baggage policy', async () => {
      const airline = await createAirline({ baggagePolicy: null });
      const flight = await createFlight(airline._id);
      await expect(
        service.quote(
          request(flight, {
            passengers: [{ ...request(flight).passengers[0], extraBags: 1 }],
          }),
        ),
      ).rejects.toThrow(/at most 0 extra bag/);
    });

    it('rejects a return flight on the wrong route or before arrival', async () => {
      const airline = await createAirline();
      const out = await createFlight(airline._id, { daysAhead: 30 });
      const wrongRoute = await createFlight(airline._id, {
        daysAhead: 37,
        from: 'LHR',
        to: 'JFK',
        number: 'NA103',
      });
      const tooEarly = await createFlight(airline._id, {
        daysAhead: 29,
        from: 'LHR',
        to: 'CAI',
        number: 'NA104',
      });
      const withReturn = (back: { _id: Types.ObjectId }) =>
        request(out, {
          returnFlight: {
            flightId: back._id.toString(),
            cabinCategory: CabinCategory.ECONOMY,
          },
        });
      await expect(service.quote(withReturn(wrongRoute))).rejects.toThrow(
        /must fly LHR to CAI/,
      );
      await expect(service.quote(withReturn(tooEarly))).rejects.toThrow(
        /depart after the outbound flight arrives/,
      );
    });
  });
});
