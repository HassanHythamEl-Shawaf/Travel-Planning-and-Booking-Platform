import { ConflictException } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { FlightInventoryService } from './flight-inventory';
import {
  FlightInventoryHold,
  FlightInventoryHoldSchema,
  InventoryHoldStatus,
} from './schemas/flight-inventory-hold.schema';
import {
  CabinCategory,
  Flight,
  FlightSchema,
  FlightStatus,
} from './schemas/flight.schema';

jest.setTimeout(120_000);

/**
 * FLT-22 inventory against a real (in-memory) MongoDB. The unit spec mocks
 * the models, so it cannot catch queries that MongoDB itself rejects.
 */
describe('FlightInventoryService on MongoDB (FLT-22)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let flights: Model<Flight>;
  let holds: Model<FlightInventoryHold>;
  let service: FlightInventoryService;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'flight-inventory' })
      .asPromise();
    flights = connection.model(
      Flight.name,
      FlightSchema,
    ) as unknown as Model<Flight>;
    holds = connection.model(
      FlightInventoryHold.name,
      FlightInventoryHoldSchema,
    ) as unknown as Model<FlightInventoryHold>;
    await holds.syncIndexes();
    service = new FlightInventoryService(flights, holds);
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  afterEach(async () => {
    await Promise.all([flights.deleteMany({}), holds.deleteMany({})]);
  });

  const inTenMinutes = () => new Date(Date.now() + 10 * 60_000);

  /** A Scheduled flight with a large Business cabin first and a small Economy cabin second. */
  async function createFlight(economySeats: number, economyBooked = 0) {
    const flight = await flights.create({
      airlineId: new Types.ObjectId(),
      flightNumber: 'NA101',
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'LHR',
      departureAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      arrivalAt: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1000 + 5 * 3600 * 1000,
      ),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Europe/London',
      departureLocalDate: '2030-01-01',
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.BUSINESS,
          seatCount: 100,
          price: 900,
          freeBaggageAllowance: 2,
          maxWeightPerBagKg: 32,
        },
        {
          category: CabinCategory.ECONOMY,
          seatCount: economySeats,
          seatsBooked: economyBooked,
          price: 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
        },
      ],
    });
    return {
      flightId: flight._id.toString(),
      businessId: flight.cabins[0]._id!.toString(),
      economyId: flight.cabins[1]._id!.toString(),
    };
  }

  async function cabins(flightId: string) {
    const flight = await flights.findById(flightId).lean().exec();
    return flight!.cabins.map(({ seatsHeld, seatsBooked }) => ({
      seatsHeld,
      seatsBooked,
    }));
  }

  it('holds seats in the requested cabin only', async () => {
    const { flightId, economyId } = await createFlight(5);

    const hold = await service.createHold(
      flightId,
      economyId,
      2,
      inTenMinutes(),
    );

    expect(hold.seats).toBe(2);
    expect(await cabins(flightId)).toEqual([
      { seatsHeld: 0, seatsBooked: 0 },
      { seatsHeld: 2, seatsBooked: 0 },
    ]);
    expect(
      await holds.countDocuments({ status: InventoryHoldStatus.HELD }),
    ).toBe(1);
  });

  it('never holds more seats than total minus booked under parallel requests', async () => {
    const { flightId, economyId } = await createFlight(5, 1);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.createHold(flightId, economyId, 1, inTenMinutes()),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(4);
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(rejected).toHaveLength(16);
    expect(rejected.every((r) => r.reason instanceof ConflictException)).toBe(
      true,
    );
    expect(await cabins(flightId)).toEqual([
      { seatsHeld: 0, seatsBooked: 0 },
      { seatsHeld: 4, seatsBooked: 1 },
    ]);
  });

  it('rejects a hold on a flight that is not Scheduled', async () => {
    const { flightId, economyId } = await createFlight(5);
    await flights.updateOne(
      { _id: flightId },
      { status: FlightStatus.CANCELLED },
    );

    await expect(
      service.createHold(flightId, economyId, 1, inTenMinutes()),
    ).rejects.toThrow(ConflictException);
  });

  it('confirms held seats into booked seats', async () => {
    const { flightId, economyId } = await createFlight(5);
    const hold = await service.createHold(
      flightId,
      economyId,
      2,
      inTenMinutes(),
    );

    await service.confirmInventory(hold.holdId);

    expect((await cabins(flightId))[1]).toEqual({
      seatsHeld: 0,
      seatsBooked: 2,
    });
    await expect(service.confirmInventory(hold.holdId)).rejects.toThrow(
      ConflictException,
    );
  });

  it('confirms and releases the right cabin when several cabins have holds', async () => {
    const { flightId, economyId, businessId } = await createFlight(5);
    const business = await service.createHold(
      flightId,
      businessId,
      3,
      inTenMinutes(),
    );
    const economy = await service.createHold(
      flightId,
      economyId,
      2,
      inTenMinutes(),
    );

    await service.confirmInventory(economy.holdId);
    expect(await cabins(flightId)).toEqual([
      { seatsHeld: 3, seatsBooked: 0 },
      { seatsHeld: 0, seatsBooked: 2 },
    ]);

    await service.releaseHold(business.holdId);
    expect(await cabins(flightId)).toEqual([
      { seatsHeld: 0, seatsBooked: 0 },
      { seatsHeld: 0, seatsBooked: 2 },
    ]);
  });

  it('releases held seats once', async () => {
    const { flightId, economyId } = await createFlight(5);
    const hold = await service.createHold(
      flightId,
      economyId,
      3,
      inTenMinutes(),
    );

    await service.releaseHold(hold.holdId);
    await service.releaseHold(hold.holdId);

    expect((await cabins(flightId))[1]).toEqual({
      seatsHeld: 0,
      seatsBooked: 0,
    });
    expect(
      await holds.countDocuments({ status: InventoryHoldStatus.RELEASED }),
    ).toBe(1);
  });

  it('releases every open hold of a flight', async () => {
    const { flightId, economyId, businessId } = await createFlight(5);
    await service.createHold(flightId, economyId, 2, inTenMinutes());
    await service.createHold(flightId, businessId, 3, inTenMinutes());

    await service.releaseFlightHolds(flightId);

    expect(await cabins(flightId)).toEqual([
      { seatsHeld: 0, seatsBooked: 0 },
      { seatsHeld: 0, seatsBooked: 0 },
    ]);
  });
});
