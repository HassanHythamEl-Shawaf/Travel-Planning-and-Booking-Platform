import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createConnection, Types } from 'mongoose';
import type { Connection, Model } from 'mongoose';

import { HotelBookingCancellationService } from './hotel-booking-cancellation.service';
import { HotelBookingStatus } from './hotel-booking-status';
import type { HotelRoomReader } from './hotel-room.reader';
import type { CancellationTerms } from './refund-rules';
import { RoomInventoryService } from './room-inventory.service';
import {
  HotelBooking,
  HotelBookingDocument,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/**
 * HTL-21 against a real (in-memory) replica set, never Atlas. The first run
 * downloads a mongod binary.
 */
jest.setTimeout(120_000);

const NOW = new Date('2026-11-18T10:00:00Z');
const USER = new Types.ObjectId().toHexString();
const OTHER_USER = new Types.ObjectId().toHexString();
const HOTEL_ID = new Types.ObjectId();
const ROOM_ID = new Types.ObjectId();

const TERMS: CancellationTerms = {
  freeCancellationHours: 24,
  refundPercentageAfterDeadline: 50,
  checkInTime: '14:00',
  description: 'Free cancellation up to 24 hours before check-in.',
};

describe('Hotel booking cancellation (HTL-21)', () => {
  let replSet: MongoMemoryReplSet;
  let connection: Connection;
  let bookingModel: Model<HotelBookingDocument>;
  let service: HotelBookingCancellationService;
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const refunds = { issueRefund: jest.fn() };

  const availability = () => connection.collection('roomavailabilities');

  /** A Confirmed booking of 300 USD, checking in 2026-12-20 unless told otherwise. */
  async function confirmedBooking(
    over: {
      checkIn?: string;
      userId?: string;
      status?: HotelBookingStatus;
      terms?: CancellationTerms | null;
    } = {},
  ) {
    const checkInDate = new Date(`${over.checkIn ?? '2026-12-20'}T00:00:00Z`);
    const checkOutDate = new Date(checkInDate.getTime() + 3 * 86_400_000);
    const _id = new Types.ObjectId();
    const status = over.status ?? HotelBookingStatus.CONFIRMED;
    const booking = await bookingModel.create({
      _id,
      userId: new Types.ObjectId(over.userId ?? USER),
      hotelId: HOTEL_ID,
      hotelName: 'Hilton Cairo',
      checkInDate,
      checkOutDate,
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
      status,
      bookingReference:
        status === HotelBookingStatus.CONFIRMED
          ? `HTL-${String(_id).slice(-8).toUpperCase()}`
          : null,
      cancellationPolicy: over.terms === undefined ? TERMS : over.terms,
    });
    await availability().insertOne({
      roomId: ROOM_ID,
      startDate: checkInDate,
      endDate: checkOutDate,
      status: 'booked',
      bookingReference: String(_id),
    });
    return booking;
  }

  const cancel = (id: Types.ObjectId, now = NOW, userId = USER, extra = {}) =>
    service.cancel(userId, String(id), { confirm: true, ...extra }, now);

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

    const reader = {
      findCancellationTerms: async () => TERMS,
    } as unknown as HotelRoomReader;

    service = new HotelBookingCancellationService(
      bookingModel,
      connection,
      new RoomInventoryService(connection),
      notifications as never,
      refunds,
      reader,
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
    refunds.issueRefund.mockReset();
    refunds.issueRefund.mockResolvedValue({
      refundId: 're_123',
      status: 'Pending',
    });
  });

  it('cancels the whole reservation, releases its rooms and refunds the full total before the deadline', async () => {
    const booking = await confirmedBooking();

    const result = await cancel(booking._id as Types.ObjectId);

    expect(result).toMatchObject({
      status: HotelBookingStatus.CANCELLED,
      refundPercentage: 100,
      refundAmount: 300,
      currency: 'USD',
      refundId: 're_123',
    });
    const stored = await bookingModel.findById(booking._id);
    expect(stored?.status).toBe(HotelBookingStatus.CANCELLED);
    expect(stored?.refundAmount).toBe(300);
    expect(stored?.refundId).toBe('re_123');
    expect(await availability().countDocuments()).toBe(0);

    expect(refunds.issueRefund).toHaveBeenCalledWith(
      {
        bookingId: String(booking._id),
        userId: USER,
        bookingReference: booking.bookingReference,
        hotelId: String(HOTEL_ID),
        totalPrice: 300,
        currency: 'USD',
      },
      { refundPercentage: 100, refundAmount: 300, currency: 'USD' },
    );
    expect(notifications.send).toHaveBeenCalledTimes(2);
    expect(notifications.send).toHaveBeenCalledWith(
      USER,
      expect.anything(),
      expect.objectContaining({ bookingType: 'hotel', amount: 300 }),
    );
  });

  it('refunds the hotel\'s after-deadline percentage inside the free-cancellation window', async () => {
    const booking = await confirmedBooking();
    // 2026-12-19 20:00 is after the 14:00 deadline but before check-in.
    const result = await cancel(
      booking._id as Types.ObjectId,
      new Date('2026-12-19T20:00:00Z'),
    );
    expect(result).toMatchObject({ refundPercentage: 50, refundAmount: 150 });
    expect(refunds.issueRefund).toHaveBeenCalledWith(expect.anything(), {
      refundPercentage: 50,
      refundAmount: 150,
      currency: 'USD',
    });
  });

  it('follows the policy snapshot, not a later change by the hotel', async () => {
    const booking = await confirmedBooking({
      terms: { ...TERMS, freeCancellationHours: 24, refundPercentageAfterDeadline: 20 },
    });
    const result = await cancel(
      booking._id as Types.ObjectId,
      new Date('2026-12-19T20:00:00Z'),
    );
    expect(result.refundPercentage).toBe(20);
  });

  it('cancels without any refund request when nothing is refundable', async () => {
    const booking = await confirmedBooking({
      terms: { ...TERMS, refundPercentageAfterDeadline: 0 },
    });
    const result = await cancel(
      booking._id as Types.ObjectId,
      new Date('2026-12-19T20:00:00Z'),
    );
    expect(result).toMatchObject({ refundAmount: 0, refundId: null });
    expect(refunds.issueRefund).not.toHaveBeenCalled();
    expect((await bookingModel.findById(booking._id))?.status).toBe(
      HotelBookingStatus.CANCELLED,
    );
  });

  it('keeps the cancellation if the refund request fails', async () => {
    refunds.issueRefund.mockRejectedValue(new Error('stripe down'));
    const booking = await confirmedBooking();
    const result = await cancel(booking._id as Types.ObjectId);
    expect(result).toMatchObject({
      status: HotelBookingStatus.CANCELLED,
      refundAmount: 300,
      refundId: null,
    });
    expect(await availability().countDocuments()).toBe(0);
  });

  it('keeps the cancellation when the refund service reports a failed refund', async () => {
    refunds.issueRefund.mockResolvedValue({ refundId: null, status: 'Failed' });
    const booking = await confirmedBooking();
    const result = await cancel(booking._id as Types.ObjectId);
    expect(result).toMatchObject({
      status: HotelBookingStatus.CANCELLED,
      refundAmount: 300,
      refundId: null,
    });
    expect((await bookingModel.findById(booking._id))?.refundId).toBeNull();
  });

  it('previews the refund without changing anything', async () => {
    const booking = await confirmedBooking();
    const preview = await service.previewRefund(
      USER,
      String(booking._id),
      NOW,
    );
    expect(preview).toMatchObject({
      refundPercentage: 100,
      refundAmount: 300,
      totalPrice: 300,
      checkIn: '2026-12-20',
    });
    expect(preview.freeCancellationUntil.toISOString()).toBe(
      '2026-12-19T14:00:00.000Z',
    );
    expect((await bookingModel.findById(booking._id))?.status).toBe(
      HotelBookingStatus.CONFIRMED,
    );
    expect(await availability().countDocuments()).toBe(1);
  });

  it('refuses without confirm, and when the refund changed since it was shown', async () => {
    const booking = await confirmedBooking();
    await expect(
      service.cancel(USER, String(booking._id), { confirm: false }, NOW),
    ).rejects.toThrow(BadRequestException);
    await expect(
      cancel(booking._id as Types.ObjectId, NOW, USER, {
        expectedRefundAmount: 150,
      }),
    ).rejects.toThrow(ConflictException);
    expect((await bookingModel.findById(booking._id))?.status).toBe(
      HotelBookingStatus.CONFIRMED,
    );
  });

  it('hides another user\'s booking as not found', async () => {
    const booking = await confirmedBooking();
    await expect(
      cancel(booking._id as Types.ObjectId, NOW, OTHER_USER),
    ).rejects.toThrow(NotFoundException);
    expect((await bookingModel.findById(booking._id))?.status).toBe(
      HotelBookingStatus.CONFIRMED,
    );
  });

  it('refuses anything that is not Confirmed', async () => {
    for (const status of [
      HotelBookingStatus.PENDING_PAYMENT,
      HotelBookingStatus.EXPIRED,
      HotelBookingStatus.COMPLETED,
      HotelBookingStatus.CANCELLED,
    ]) {
      const booking = await confirmedBooking({ status });
      await expect(cancel(booking._id as Types.ObjectId)).rejects.toThrow(
        ConflictException,
      );
    }
  });

  it('refuses on or after the check-in date', async () => {
    const booking = await confirmedBooking();
    await expect(
      cancel(booking._id as Types.ObjectId, new Date('2026-12-20T00:00:00Z')),
    ).rejects.toThrow(ConflictException);
    await expect(
      cancel(booking._id as Types.ObjectId, new Date('2026-12-21T09:00:00Z')),
    ).rejects.toThrow(ConflictException);
    expect(await availability().countDocuments()).toBe(1);
  });

  it('lets only one of two parallel cancellations win and refunds once', async () => {
    const booking = await confirmedBooking();
    const results = await Promise.allSettled([
      cancel(booking._id as Types.ObjectId),
      cancel(booking._id as Types.ObjectId),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(lost?.reason).toBeInstanceOf(ConflictException);
    expect(refunds.issueRefund).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledTimes(2);
  });
});