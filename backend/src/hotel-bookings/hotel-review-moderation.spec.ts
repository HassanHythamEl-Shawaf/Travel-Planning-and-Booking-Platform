import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, Types } from 'mongoose';
import type { ClientSession, Connection, Model } from 'mongoose';

import type { ModerationHandler } from '../moderation/moderation.types';
import { HotelReviewModerationHandler } from './hotel-review-moderation.handler';
import { HotelReviewsService } from './hotel-reviews.service';
import { HotelBookingStatus } from './hotel-booking-status';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';
import { Review, ReviewDocument, ReviewSchema } from './schemas/review.schema';

/**
 * GEN-10 for reviews against a real (in-memory) replica set, never Atlas.
 * The first run downloads a mongod binary.
 */
jest.setTimeout(120_000);

// HotelReviewsService gained a constructor parameter in HTL-24; extra
// arguments are ignored before that, so this spec works on both branches.
const ReviewsService = HotelReviewsService as unknown as new (
  ...args: unknown[]
) => HotelReviewsService;

const NOW = new Date('2026-11-18T10:00:00Z');
const HOTEL_ID = new Types.ObjectId();
const ROOM_ID = new Types.ObjectId();

describe('Review moderation handler (GEN-10)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let bookingModel: Model<HotelBookingDocument>;
  let reviewModel: Model<ReviewDocument>;
  let service: HotelReviewsService;
  let handler: ModerationHandler;
  const registry = { register: jest.fn() };

  const hotels = () => connection.collection('hotels');
  const hotelRating = async () =>
    (await hotels().findOne({ _id: HOTEL_ID }))?.averageRating;

  /** Runs `fn` in a transaction, as an admin moderation action does. */
  async function asAdminAction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
    const out: { value?: T } = {};
    await connection.transaction(async (session) => {
      out.value = await fn(session);
    });
    return out.value as T;
  }

  async function makeReview(rating: number, comment?: string) {
    const userId = new Types.ObjectId();
    const _id = new Types.ObjectId();
    await bookingModel.create({
      _id,
      userId,
      hotelId: HOTEL_ID,
      hotelName: 'Hilton Cairo',
      checkInDate: new Date('2026-10-01T00:00:00Z'),
      checkOutDate: new Date('2026-10-04T00:00:00Z'),
      nights: 3,
      rooms: [
        {
          roomId: ROOM_ID,
          roomName: 'Deluxe',
          pricePerNight: 100,
          adults: 1,
          childrenAges: [],
          subtotal: 300,
        },
      ],
      totalPrice: 300,
      currency: 'USD',
      status: HotelBookingStatus.COMPLETED,
      bookingReference: `HTL-${String(_id).slice(-8).toUpperCase()}`,
    });
    return service.create(String(userId), String(_id), { rating, comment }, NOW);
  }

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    connection = createConnection(replSet.getUri());
    await connection.asPromise();
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

    service = new ReviewsService(bookingModel, reviewModel, connection, {
      findHotel: async () => ({ id: String(HOTEL_ID), name: 'Hilton', isActive: true }),
    });
    new HotelReviewModerationHandler(
      registry as never,
      reviewModel,
      service,
    ).onModuleInit();
    handler = registry.register.mock.calls[0][1] as ModerationHandler;
  });

  afterAll(async () => {
    await connection.close();
    await replSet.stop();
  });

  beforeEach(async () => {
    await bookingModel.deleteMany({});
    await reviewModel.deleteMany({});
    await hotels().deleteMany({});
    await hotels().insertOne({
      _id: HOTEL_ID,
      name: 'Hilton Cairo',
      isActive: true,
      averageRating: 0,
    });
  });

  it('registers itself as the handler for reviews', () => {
    expect(registry.register).toHaveBeenCalledWith('review', expect.any(Object));
  });

  it('finds a review with its author, visibility and a short excerpt', async () => {
    const created = await makeReview(4, 'x'.repeat(500));
    const found = await handler.find(created.id);
    expect(found).toMatchObject({
      id: created.id,
      type: 'review',
      isHidden: false,
      publiclyVisible: true,
    });
    expect(found?.authorId).toMatch(/^[0-9a-f]{24}$/);
    expect(found?.snapshot).toEqual({ excerpt: 'x'.repeat(200) });

    expect(await handler.find(new Types.ObjectId().toHexString())).toBeNull();
    expect(await handler.find('not-an-id')).toBeNull();
  });

  it('hides a review, leaves it out of the average, and unhides it again', async () => {
    const kept = await makeReview(5);
    const hidden = await makeReview(1);
    expect(await hotelRating()).toBe(3);

    expect(await asAdminAction((s) => handler.setHidden(hidden.id, true, s))).toBe(true);
    expect(await hotelRating()).toBe(5);
    expect((await handler.find(hidden.id))?.publiclyVisible).toBe(false);
    expect((await handler.find(kept.id))?.publiclyVisible).toBe(true);

    expect(await asAdminAction((s) => handler.setHidden(hidden.id, false, s))).toBe(true);
    expect(await hotelRating()).toBe(3);
  });

  it('changes nothing when the review is already in the requested state', async () => {
    const review = await makeReview(2);
    await makeReview(4);
    expect(await asAdminAction((s) => handler.setHidden(review.id, false, s))).toBe(false);
    expect(await asAdminAction((s) => handler.setHidden(review.id, true, s))).toBe(true);
    expect(await asAdminAction((s) => handler.setHidden(review.id, true, s))).toBe(false);
    expect(await hotelRating()).toBe(4);
    expect(await asAdminAction((s) => handler.setHidden('not-an-id', true, s))).toBe(false);
  });

  it('deletes a review and recalculates the average, once', async () => {
    const doomed = await makeReview(1);
    await makeReview(5);
    expect(await hotelRating()).toBe(3);

    expect(await asAdminAction((s) => handler.delete(doomed.id, s))).toBe(true);
    expect(await reviewModel.countDocuments()).toBe(1);
    expect(await hotelRating()).toBe(5);

    expect(await asAdminAction((s) => handler.delete(doomed.id, s))).toBe(false);
    expect(await hotelRating()).toBe(5);
  });

  it('rolls the rating back with the rest of the action if it fails', async () => {
    const review = await makeReview(1);
    await makeReview(5);
    await expect(
      asAdminAction(async (s) => {
        await handler.setHidden(review.id, true, s);
        throw new Error('audit entry failed');
      }),
    ).rejects.toThrow('audit entry failed');
    expect(await hotelRating()).toBe(3);
    expect((await handler.find(review.id))?.isHidden).toBe(false);
  });
});