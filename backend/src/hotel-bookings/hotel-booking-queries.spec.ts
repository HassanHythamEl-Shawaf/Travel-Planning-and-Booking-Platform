import { NotFoundException } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { HotelBookingGroup } from './hotel-booking-group';
import { HotelBookingQueryService } from './hotel-booking-query.service';
import { HotelBookingStatus } from './hotel-booking-status';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/**
 * HTL-20 against a real (in-memory) database, never Atlas. The first run
 * downloads a mongod binary.
 */
jest.setTimeout(120_000);

const NOW = new Date('2026-11-18T10:00:00Z');
const USER = new Types.ObjectId().toHexString();
const OTHER_USER = new Types.ObjectId().toHexString();
const HOTEL_ID = new Types.ObjectId();
const ROOM_ID = new Types.ObjectId();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('Hotel booking list and details (HTL-20)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let bookingModel: Model<HotelBookingDocument>;
  let service: HotelBookingQueryService;

  async function make(
    over: {
      userId?: string;
      status?: HotelBookingStatus;
      checkIn?: string;
      checkOut?: string;
      holdExpiresAt?: Date | null;
      hotelName?: string;
    } = {},
  ) {
    const _id = new Types.ObjectId();
    const status = over.status ?? HotelBookingStatus.CONFIRMED;
    return bookingModel.create({
      _id,
      userId: new Types.ObjectId(over.userId ?? USER),
      hotelId: HOTEL_ID,
      hotelName: over.hotelName ?? 'Hilton Cairo',
      checkInDate: day(over.checkIn ?? '2026-12-20'),
      checkOutDate: day(over.checkOut ?? '2026-12-23'),
      nights: 3,
      rooms: [
        {
          roomId: ROOM_ID,
          roomName: 'Deluxe',
          pricePerNight: 100,
          adults: 2,
          childrenAges: [5],
          subtotal: 300,
        },
      ],
      totalPrice: 300,
      currency: 'USD',
      status,
      holdExpiresAt: over.holdExpiresAt ?? null,
      bookingReference:
        status === HotelBookingStatus.CONFIRMED ||
        status === HotelBookingStatus.COMPLETED ||
        status === HotelBookingStatus.CANCELLED
          ? `HTL-${String(_id).slice(-8).toUpperCase()}`
          : null,
    });
  }

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
    service = new HotelBookingQueryService(bookingModel);
  });

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await bookingModel.deleteMany({});
  });

  async function seedEveryState() {
    return {
      future: await make({ checkIn: '2026-12-20', checkOut: '2026-12-23' }),
      sooner: await make({ checkIn: '2026-11-25', checkOut: '2026-11-27' }),
      inStay: await make({ checkIn: '2026-11-17', checkOut: '2026-11-20' }),
      holding: await make({
        status: HotelBookingStatus.PENDING_PAYMENT,
        holdExpiresAt: new Date('2026-11-18T10:05:00Z'),
      }),
      staleHold: await make({
        status: HotelBookingStatus.PENDING_PAYMENT,
        holdExpiresAt: new Date('2026-11-18T09:00:00Z'),
      }),
      ended: await make({ checkIn: '2026-10-01', checkOut: '2026-10-04' }),
      completed: await make({
        status: HotelBookingStatus.COMPLETED,
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
      }),
      cancelled: await make({ status: HotelBookingStatus.CANCELLED }),
      expired: await make({ status: HotelBookingStatus.EXPIRED }),
      someoneElses: await make({ userId: OTHER_USER }),
    };
  }

  it('groups reservations as Upcoming, Past and Cancelled with counts', async () => {
    const seeded = await seedEveryState();

    const upcoming = await service.listMine(
      USER,
      HotelBookingGroup.UPCOMING,
      undefined,
      NOW,
    );
    // Soonest stay first; a stay in progress and a running hold still count.
    expect(upcoming.data.map((b) => b.id)).toEqual(
      [seeded.inStay, seeded.sooner, seeded.future, seeded.holding]
        .sort((a, b) => a.checkInDate.getTime() - b.checkInDate.getTime())
        .map((b) => String(b._id)),
    );
    expect(upcoming.data).toHaveLength(4);
    expect(upcoming.counts).toEqual({ upcoming: 4, past: 2, cancelled: 2 });
    expect(upcoming.total).toBe(4);

    const past = await service.listMine(USER, HotelBookingGroup.PAST, 1, NOW);
    expect(past.data.map((b) => b.id)).toEqual([
      String(seeded.ended._id),
      String(seeded.completed._id),
    ]);

    const cancelled = await service.listMine(
      USER,
      HotelBookingGroup.CANCELLED,
      1,
      NOW,
    );
    expect(cancelled.data.map((b) => b.id).sort()).toEqual(
      [String(seeded.cancelled._id), String(seeded.expired._id)].sort(),
    );
  });

  it('never shows an unswept expired hold or another user\'s reservations', async () => {
    const seeded = await seedEveryState();
    const seen = new Set<string>();
    for (const group of Object.values(HotelBookingGroup)) {
      const page = await service.listMine(USER, group, 1, NOW);
      page.data.forEach((b) => seen.add(b.id));
    }
    expect(seen.has(String(seeded.staleHold._id))).toBe(false);
    expect(seen.has(String(seeded.someoneElses._id))).toBe(false);
    expect(seen.size).toBe(8);
  });

  it('lists reference, hotel, rooms, dates, guests, total and status', async () => {
    await make();
    const [item] = (
      await service.listMine(USER, HotelBookingGroup.UPCOMING, 1, NOW)
    ).data;
    expect(item).toMatchObject({
      hotelName: 'Hilton Cairo',
      checkIn: '2026-12-20',
      checkOut: '2026-12-23',
      nights: 3,
      rooms: [{ roomName: 'Deluxe', adults: 2, children: 1 }],
      guests: { adults: 2, children: 1 },
      totalPrice: 300,
      currency: 'USD',
      status: HotelBookingStatus.CONFIRMED,
    });
    expect(item.bookingReference).toMatch(/^HTL-/);
  });

  it('pages 10 at a time', async () => {
    for (let i = 0; i < 25; i++) {
      await make({
        status: HotelBookingStatus.COMPLETED,
        checkIn: '2026-09-01',
        checkOut: '2026-09-03',
      });
    }
    const first = await service.listMine(USER, HotelBookingGroup.PAST, 1, NOW);
    const third = await service.listMine(USER, HotelBookingGroup.PAST, 3, NOW);
    expect(first.data).toHaveLength(10);
    expect(third.data).toHaveLength(5);
    expect(first).toMatchObject({ total: 25, totalPages: 3, limit: 10, page: 1 });
    expect(third.page).toBe(3);
    const ids = new Set([
      ...first.data.map((b) => b.id),
      ...(await service.listMine(USER, HotelBookingGroup.PAST, 2, NOW)).data.map(
        (b) => b.id,
      ),
      ...third.data.map((b) => b.id),
    ]);
    expect(ids.size).toBe(25);
  });

  it('opens the full details of my own reservation', async () => {
    const booking = await make();
    const details = await service.getMine(USER, String(booking._id), NOW);
    expect(details).toMatchObject({
      id: String(booking._id),
      hotelName: 'Hilton Cairo',
      cancellable: true,
      rooms: [
        {
          roomName: 'Deluxe',
          pricePerNight: 100,
          adults: 2,
          childrenAges: [5],
          subtotal: 300,
        },
      ],
    });
  });

  it('reports someone else\'s reservation, or an unknown id, as not found', async () => {
    const booking = await make();
    await expect(
      service.getMine(OTHER_USER, String(booking._id), NOW),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.getMine(USER, new Types.ObjectId().toHexString(), NOW),
    ).rejects.toThrow(NotFoundException);
  });
});