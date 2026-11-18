import { ConflictException } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { HotelBookingHoldService } from './hotel-booking-hold.service';
import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingStatus } from './hotel-booking-status';
import { HotelBookingsService } from './hotel-bookings.service';
import type { HotelRoomReader } from './hotel-room.reader';
import { RoomInventoryService } from './room-inventory.service';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/**
 * HTL-18 against a real (in-memory) replica set, never Atlas: transactions
 * and concurrency cannot be proven with fakes. The first run downloads a
 * mongod binary.
 */
jest.setTimeout(120_000);

const NOW = new Date('2026-11-18T10:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const HOTEL_ID = new Types.ObjectId().toHexString();
const R1 = new Types.ObjectId().toHexString();
const R2 = new Types.ObjectId().toHexString();
const room = (id: string, name: string, pricePerNight: number) => ({
  id,
  hotelId: HOTEL_ID,
  name,
  pricePerNight,
  maxAdults: 2,
  maxChildren: 1,
  isActive: true,
});

describe('Hotel booking holds (HTL-18)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let bookingModel: Model<HotelBookingDocument>;
  let holds: HotelBookingHoldService;
  let lifecycle: HotelBookingLifecycleService;
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };

  const availability = () => connection.collection('roomavailabilities');
  const newUser = () => new Types.ObjectId().toHexString();
  const dto = (
    roomIds: string[],
    checkIn = '2026-12-20',
    checkOut = '2026-12-23',
  ): QuoteHotelBookingDto => ({
    hotelId: HOTEL_ID,
    checkIn,
    checkOut,
    rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
  });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = createConnection(replSet.getUri());
    await connection.asPromise();
    // No generic: its meaning differs between Mongoose versions.
    bookingModel = connection.model(
      HotelBooking.name,
      HotelBookingSchema,
    ) as unknown as Model<HotelBookingDocument>;
    await bookingModel.init();

    // The advisory availability check is switched off so these tests prove
    // that the transaction alone prevents double booking.
    const reader: HotelRoomReader = {
      findHotel: async () => ({
        id: HOTEL_ID,
        name: 'Hilton Cairo',
        isActive: true,
      }),
      findRoomsOfHotel: async () => [
        room(R1, 'Deluxe', 100),
        room(R2, 'Suite', 150.5),
      ],
      isRoomAvailable: async () => true,
      confirmRoomDates: async (holdKey) => {
        await availability().updateMany(
          { bookingReference: holdKey },
          { $set: { status: 'booked' } },
        );
      },
    };

    const inventory = new RoomInventoryService(connection);
    lifecycle = new HotelBookingLifecycleService(
      bookingModel,
      reader,
      notifications as never,
      connection,
      inventory,
    );
    holds = new HotelBookingHoldService(
      new HotelBookingsService(reader),
      lifecycle,
      inventory,
      bookingModel,
      connection,
    );
  });

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await bookingModel.deleteMany({});
    await availability().deleteMany({});
    notifications.send.mockClear();
  });

  it('holds all rooms together as one Pending Payment reservation for 10 minutes', async () => {
    const hold = await holds.hold(newUser(), dto([R1, R2]), NOW);

    expect(hold.status).toBe(HotelBookingStatus.PENDING_PAYMENT);
    expect(hold.holdExpiresAt).toEqual(minutes(10));
    expect(hold.totalPrice).toBe(751.5);

    expect(await bookingModel.countDocuments()).toBe(1);
    const entries = await availability().find({}).toArray();
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.status).toBe('held');
      expect(entry.bookingReference).toBe(hold.id);
    }
  });

  it('lets exactly one of 20 parallel holds on the same room win', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        holds.hold(newUser(), dto([R1]), NOW),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);
    for (const r of lost) expect(r.reason).toBeInstanceOf(ConflictException);

    expect(await availability().countDocuments()).toBe(1);
    expect(
      await bookingModel.countDocuments({
        status: HotelBookingStatus.PENDING_PAYMENT,
      }),
    ).toBe(1);
  });

  it('rejects the whole request and holds nothing if one room is blocked', async () => {
    await availability().insertOne({
      roomId: new Types.ObjectId(R2),
      startDate: new Date('2026-12-21T00:00:00Z'),
      endDate: new Date('2026-12-22T00:00:00Z'),
      status: 'maintenance',
    });

    await expect(holds.hold(newUser(), dto([R1, R2]), NOW)).rejects.toThrow(
      ConflictException,
    );

    expect(await bookingModel.countDocuments()).toBe(0);
    expect(
      await availability().countDocuments({ roomId: new Types.ObjectId(R1) }),
    ).toBe(0);
  });

  it('treats a check-out day as free but rejects a real overlap', async () => {
    await holds.hold(newUser(), dto([R1], '2026-12-20', '2026-12-23'), NOW);

    await expect(
      holds.hold(newUser(), dto([R1], '2026-12-23', '2026-12-26'), NOW),
    ).resolves.toBeDefined();
    await expect(
      holds.hold(newUser(), dto([R1], '2026-12-22', '2026-12-24'), NOW),
    ).rejects.toThrow(ConflictException);
  });

  it('expires an unpaid hold, releases its rooms and notifies the guest', async () => {
    const user = newUser();
    const hold = await holds.hold(user, dto([R1, R2]), NOW);

    expect(await lifecycle.releaseExpiredHolds(minutes(9))).toBe(0);
    expect(
      (await bookingModel.findById(hold.id))?.status,
    ).toBe(HotelBookingStatus.PENDING_PAYMENT);

    expect(await lifecycle.releaseExpiredHolds(minutes(11))).toBe(1);
    expect((await bookingModel.findById(hold.id))?.status).toBe(
      HotelBookingStatus.EXPIRED,
    );
    expect(await availability().countDocuments()).toBe(0);
    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(
      user,
      expect.anything(),
      expect.objectContaining({ bookingType: 'hotel', bookingId: hold.id }),
    );

    // The rooms are bookable again.
    await expect(
      holds.hold(newUser(), dto([R1, R2]), minutes(11)),
    ).resolves.toBeDefined();
  });

  it('sweeps an expired hold on its own when someone else asks for the room', async () => {
    const first = await holds.hold(newUser(), dto([R1]), NOW);
    await expect(
      holds.hold(newUser(), dto([R1]), minutes(11)),
    ).resolves.toBeDefined();
    expect((await bookingModel.findById(first.id))?.status).toBe(
      HotelBookingStatus.EXPIRED,
    );
  });

  it('keeps a Confirmed reservation blocking and safe from the expiry sweep', async () => {
    const hold = await holds.hold(newUser(), dto([R1]), NOW);
    await lifecycle.confirmBooking(hold.id, minutes(1));

    await expect(
      holds.hold(newUser(), dto([R1]), minutes(2)),
    ).rejects.toThrow(ConflictException);

    expect(await lifecycle.releaseExpiredHolds(minutes(60))).toBe(0);
    expect((await bookingModel.findById(hold.id))?.status).toBe(
      HotelBookingStatus.CONFIRMED,
    );
    expect(await availability().countDocuments({ status: 'booked' })).toBe(1);
  });

  it('releaseHold expires a Pending hold at once and ignores a Confirmed one', async () => {
    const pending = await holds.hold(newUser(), dto([R1]), NOW);
    await lifecycle.releaseHold(pending.id);
    expect((await bookingModel.findById(pending.id))?.status).toBe(
      HotelBookingStatus.EXPIRED,
    );

    const other = await holds.hold(newUser(), dto([R2]), NOW);
    await lifecycle.confirmBooking(other.id, minutes(1));
    await lifecycle.releaseHold(other.id);
    expect((await bookingModel.findById(other.id))?.status).toBe(
      HotelBookingStatus.CONFIRMED,
    );
  });
});