import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingStatus } from './hotel-booking-status';
import { HotelReviewsService } from './hotel-reviews.service';
import type { HotelRoomReader } from './hotel-room.reader';
import { RoomInventoryService } from './room-inventory.service';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';
import { Review, ReviewDocument, ReviewSchema } from './schemas/review.schema';

/**
 * HTL-23 against a real (in-memory) replica set, never Atlas. The first run
 * downloads a mongod binary.
 */
jest.setTimeout(120_000);

const NOW = new Date('2026-11-18T10:00:00Z');
const HOTEL_ID = new Types.ObjectId();
const ROOM_ID = new Types.ObjectId();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('Hotel reviews and completion (HTL-23)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let bookingModel: Model<HotelBookingDocument>;
  let reviewModel: Model<ReviewDocument>;
  let service: HotelReviewsService;
  let lifecycle: HotelBookingLifecycleService;

  const hotels = () => connection.collection('hotels');
  const users = () => connection.collection('users');
  const hotelRating = async () =>
    (await hotels().findOne({ _id: HOTEL_ID }))?.averageRating;

  async function makeUser(name: string, extra: Record<string, unknown> = {}) {
    const _id = new Types.ObjectId();
    await users().insertOne({ _id, name, status: 'active', ...extra });
    return String(_id);
  }

  /** A stay of 3 nights that ended before NOW unless told otherwise. */
  async function makeBooking(
    userId: string,
    over: {
      status?: HotelBookingStatus;
      checkIn?: string;
      checkOut?: string;
      rooms?: number;
    } = {},
  ) {
    const _id = new Types.ObjectId();
    const status = over.status ?? HotelBookingStatus.COMPLETED;
    const room = (i: number) => ({
      roomId: ROOM_ID,
      roomName: `Room ${i}`,
      pricePerNight: 100,
      adults: 1,
      childrenAges: [],
      subtotal: 300,
    });
    return bookingModel.create({
      _id,
      userId: new Types.ObjectId(userId),
      hotelId: HOTEL_ID,
      hotelName: 'Hilton Cairo',
      checkInDate: day(over.checkIn ?? '2026-10-01'),
      checkOutDate: day(over.checkOut ?? '2026-10-04'),
      nights: 3,
      rooms: Array.from({ length: over.rooms ?? 1 }, (_, i) => room(i + 1)),
      totalPrice: 300 * (over.rooms ?? 1),
      currency: 'USD',
      status,
      bookingReference:
        status === HotelBookingStatus.PENDING_PAYMENT ||
        status === HotelBookingStatus.EXPIRED
          ? null
          : `HTL-${String(_id).slice(-8).toUpperCase()}`,
    });
  }

  const review = (userId: string, booking: { _id: unknown }, rating: number, comment?: string) =>
    service.create(userId, String(booking._id), { rating, comment }, NOW);

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = createConnection(replSet.getUri());
    await connection.asPromise();
    // No generic: its meaning differs between Mongoose versions.
    bookingModel = connection.model(
      HotelBooking.name,
      HotelBookingSchema,
    ) as unknown as Model<HotelBookingDocument>;
    reviewModel = connection.model(
      Review.name,
      ReviewSchema,
    ) as unknown as Model<ReviewDocument>;
    await bookingModel.init();
    await reviewModel.init();

    const reader = {
      findHotel: async (id: string) =>
        id === String(HOTEL_ID)
          ? { id, name: 'Hilton Cairo', isActive: true }
          : null,
      confirmRoomDates: async () => undefined,
    } as unknown as HotelRoomReader;

    service = new HotelReviewsService(bookingModel, reviewModel, connection, reader);
    lifecycle = new HotelBookingLifecycleService(
      bookingModel,
      reader,
      { send: jest.fn() } as never,
      connection,
      new RoomInventoryService(connection),
    );
  });

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await bookingModel.deleteMany({});
    await reviewModel.deleteMany({});
    await users().deleteMany({});
    await hotels().deleteMany({});
    await hotels().insertOne({
      _id: HOTEL_ID,
      name: 'Hilton Cairo',
      isActive: true,
      averageRating: 0,
    });
  });

  describe('completion (GEN-11)', () => {
    it('completes Confirmed stays whose check-out has passed, and nothing else', async () => {
      const user = await makeUser('Ana');
      const ended = await makeBooking(user, { status: HotelBookingStatus.CONFIRMED });
      const inStay = await makeBooking(user, {
        status: HotelBookingStatus.CONFIRMED,
        checkIn: '2026-11-17',
        checkOut: '2026-11-20',
      });
      const pending = await makeBooking(user, {
        status: HotelBookingStatus.PENDING_PAYMENT,
      });
      const cancelled = await makeBooking(user, {
        status: HotelBookingStatus.CANCELLED,
      });

      expect(await lifecycle.completeEndedStays(NOW)).toBe(1);

      const status = async (b: { _id: unknown }) =>
        (await bookingModel.findById(b._id))?.status;
      expect(await status(ended)).toBe(HotelBookingStatus.COMPLETED);
      expect((await bookingModel.findById(ended._id))?.completedAt).toEqual(NOW);
      expect(await status(inStay)).toBe(HotelBookingStatus.CONFIRMED);
      expect(await status(pending)).toBe(HotelBookingStatus.PENDING_PAYMENT);
      expect(await status(cancelled)).toBe(HotelBookingStatus.CANCELLED);
      expect(await lifecycle.completeEndedStays(NOW)).toBe(0);
    });
  });

  describe('creating a review', () => {
    it('reviews a Completed stay and updates the hotel average', async () => {
      const user = await makeUser('Ana');
      const booking = await makeBooking(user);
      const created = await review(user, booking, 4, '  Lovely stay  ');

      expect(created).toMatchObject({
        rating: 4,
        comment: 'Lovely stay',
        isHidden: false,
        hotelId: String(HOTEL_ID),
        bookingId: String(booking._id),
      });
      expect(await hotelRating()).toBe(4);
    });

    it('allows a single review for a many-room reservation', async () => {
      const user = await makeUser('Ana');
      const booking = await makeBooking(user, { rooms: 3 });
      await review(user, booking, 5);
      await expect(review(user, booking, 1)).rejects.toThrow(ConflictException);
      expect(await reviewModel.countDocuments()).toBe(1);
    });

    it('completes a Confirmed stay after check-out when it is reviewed', async () => {
      const user = await makeUser('Ana');
      const booking = await makeBooking(user, {
        status: HotelBookingStatus.CONFIRMED,
      });
      await review(user, booking, 3);
      expect((await bookingModel.findById(booking._id))?.status).toBe(
        HotelBookingStatus.COMPLETED,
      );
    });

    it('refuses stays that are not over, not Confirmed, or not yours', async () => {
      const user = await makeUser('Ana');
      const other = await makeUser('Ben');
      const upcoming = await makeBooking(user, {
        status: HotelBookingStatus.CONFIRMED,
        checkIn: '2026-12-20',
        checkOut: '2026-12-23',
      });
      const inStay = await makeBooking(user, {
        status: HotelBookingStatus.CONFIRMED,
        checkIn: '2026-11-17',
        checkOut: '2026-11-20',
      });
      for (const status of [
        HotelBookingStatus.PENDING_PAYMENT,
        HotelBookingStatus.CANCELLED,
        HotelBookingStatus.EXPIRED,
      ]) {
        await expect(
          review(user, await makeBooking(user, { status }), 5),
        ).rejects.toThrow(ConflictException);
      }
      await expect(review(user, upcoming, 5)).rejects.toThrow(ConflictException);
      await expect(review(user, inStay, 5)).rejects.toThrow(ConflictException);

      const mine = await makeBooking(user);
      await expect(review(other, mine, 5)).rejects.toThrow(NotFoundException);
      expect(await reviewModel.countDocuments()).toBe(0);
      expect(await hotelRating()).toBe(0);
    });

    it('rejects bad ratings and over-long comments', async () => {
      const user = await makeUser('Ana');
      const booking = await makeBooking(user);
      for (const rating of [0, 6, 2.5]) {
        await expect(review(user, booking, rating)).rejects.toThrow(
          BadRequestException,
        );
      }
      await expect(
        review(user, booking, 5, 'x'.repeat(1001)),
      ).rejects.toThrow(BadRequestException);
      await expect(review(user, booking, 5, 'x'.repeat(1000))).resolves.toBeDefined();
    });

    it('keeps the average exact when many guests review at once', async () => {
      const ratings = [5, 4, 3, 2, 1, 5, 4, 3, 2, 5];
      const reviewers = await Promise.all(
        ratings.map(async (_, i) => {
          const userId = await makeUser(`Guest ${i}`);
          return { userId, booking: await makeBooking(userId) };
        }),
      );
      await Promise.all(
        reviewers.map(({ userId, booking }, i) =>
          review(userId, booking, ratings[i]),
        ),
      );
      const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(await reviewModel.countDocuments()).toBe(10);
      expect(await hotelRating()).toBe(Math.round(mean * 100) / 100);
    });
  });

  describe('editing and deleting', () => {
    it('edits my rating and comment and recalculates the average', async () => {
      const ana = await makeUser('Ana');
      const ben = await makeUser('Ben');
      const mine = await review(ana, await makeBooking(ana), 5, 'Great');
      await review(ben, await makeBooking(ben), 2);
      expect(await hotelRating()).toBe(3.5);

      const edited = await service.update(ana, mine.id, { rating: 3, comment: 'Fine' });
      expect(edited).toMatchObject({ rating: 3, comment: 'Fine' });
      expect(await hotelRating()).toBe(2.5);

      const cleared = await service.update(ana, mine.id, { comment: '' });
      expect(cleared.comment).toBeNull();
      expect(cleared.rating).toBe(3);
    });

    it('refuses empty edits, bad values, and other people\'s reviews', async () => {
      const ana = await makeUser('Ana');
      const ben = await makeUser('Ben');
      const mine = await review(ana, await makeBooking(ana), 5);
      await expect(service.update(ana, mine.id, {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update(ana, mine.id, { rating: 9 })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update(ben, mine.id, { rating: 1 })).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove(ben, mine.id)).rejects.toThrow(NotFoundException);
      expect(await hotelRating()).toBe(5);
    });

    it('deletes my review, recalculates, and lets the stay be reviewed again', async () => {
      const ana = await makeUser('Ana');
      const booking = await makeBooking(ana);
      const mine = await review(ana, booking, 5);
      expect(await hotelRating()).toBe(5);

      await service.remove(ana, mine.id);
      expect(await reviewModel.countDocuments()).toBe(0);
      expect(await hotelRating()).toBe(0);

      await expect(review(ana, booking, 2)).resolves.toBeDefined();
      expect(await hotelRating()).toBe(2);
    });
  });

  describe('listing a hotel\'s reviews', () => {
    it('lists newest first, with the average, and names the reviewer', async () => {
      const ana = await makeUser('Ana');
      const ben = await makeUser('Ben');
      await review(ana, await makeBooking(ana), 5, 'First');
      await new Promise((r) => setTimeout(r, 15));
      await review(ben, await makeBooking(ben), 3, 'Second');

      const list = await service.listForHotel(String(HOTEL_ID), 1);
      expect(list.data.map((r) => r.comment)).toEqual(['Second', 'First']);
      expect(list.data.map((r) => r.reviewerName)).toEqual(['Ben', 'Ana']);
      expect(list).toMatchObject({
        total: 2,
        ratingCount: 2,
        averageRating: 4,
        limit: 10,
        page: 1,
      });
    });

    it('shows a deactivated reviewer as Deleted user', async () => {
      const gone = await makeUser('Zed', { status: 'deactivated' });
      await review(gone, await makeBooking(gone), 4, 'Nice');
      const [item] = (await service.listForHotel(String(HOTEL_ID), 1)).data;
      expect(item.reviewerName).toBe('Deleted user');
    });

    it('keeps the name of a suspended reviewer, and shows a missing user as Deleted user', async () => {
      const suspended = await makeUser('Sam', { status: 'suspended' });
      const vanished = await makeUser('Vic');
      await review(suspended, await makeBooking(suspended), 4, 'Fine');
      await new Promise((r) => setTimeout(r, 15));
      await review(vanished, await makeBooking(vanished), 3, 'Okay');
      await users().deleteOne({ _id: new Types.ObjectId(vanished) });

      const names = (await service.listForHotel(String(HOTEL_ID), 1)).data.map(
        (r) => r.reviewerName,
      );
      expect(names).toEqual(['Deleted user', 'Sam']);
    });

    it('leaves hidden reviews out of the list and the average', async () => {
      const ana = await makeUser('Ana');
      const ben = await makeUser('Ben');
      const kept = await review(ana, await makeBooking(ana), 5);
      const hidden = await review(ben, await makeBooking(ben), 1);
      expect(await hotelRating()).toBe(3);

      await reviewModel.updateOne({ _id: hidden.id }, { $set: { isHidden: true } });
      expect(await service.recomputeHotelRating(String(HOTEL_ID))).toBe(5);
      expect(await hotelRating()).toBe(5);

      const list = await service.listForHotel(String(HOTEL_ID), 1);
      expect(list.data.map((r) => r.id)).toEqual([kept.id]);
      expect(list).toMatchObject({ total: 1, ratingCount: 1, averageRating: 5 });
    });

    it('counts every rating, with or without a comment', async () => {
      const ana = await makeUser('Ana');
      const ben = await makeUser('Ben');
      await review(ana, await makeBooking(ana), 5);
      await review(ben, await makeBooking(ben), 2, 'Noisy');

      const list = await service.listForHotel(String(HOTEL_ID), 1);
      expect(list).toMatchObject({ ratingCount: 2, averageRating: 3.5 });
      expect(list.data.map((r) => r.comment).sort()).toEqual([null, 'Noisy']);
    });

    it('shows zeros for a hotel nobody has reviewed', async () => {
      await expect(service.listForHotel(String(HOTEL_ID), 1)).resolves.toMatchObject({
        averageRating: 0,
        ratingCount: 0,
        total: 0,
        totalPages: 0,
        data: [],
      });
    });

    it('pages 10 at a time', async () => {
      for (let i = 0; i < 25; i++) {
        const user = await makeUser(`Guest ${i}`);
        await review(user, await makeBooking(user), 4);
      }
      const first = await service.listForHotel(String(HOTEL_ID), 1);
      const third = await service.listForHotel(String(HOTEL_ID), 3);
      expect(first.data).toHaveLength(10);
      expect(third.data).toHaveLength(5);
      expect(first).toMatchObject({ total: 25, totalPages: 3 });
      const ids = new Set([
        ...first.data.map((r) => r.id),
        ...(await service.listForHotel(String(HOTEL_ID), 2)).data.map((r) => r.id),
        ...third.data.map((r) => r.id),
      ]);
      expect(ids.size).toBe(25);
    });

    it('reports an unknown hotel as not found', async () => {
      await expect(
        service.listForHotel(new Types.ObjectId().toHexString(), 1),
      ).rejects.toThrow(NotFoundException);
    });
  });
});