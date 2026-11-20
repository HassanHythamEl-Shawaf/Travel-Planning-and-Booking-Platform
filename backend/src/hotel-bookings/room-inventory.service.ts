import { ConflictException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';

/** Default collection of the hotels module's RoomAvailability model. */
const AVAILABILITY_COLLECTION = 'roomavailabilities';
/** One tiny document per room; see hold(). Owned by this module. */
const LOCK_COLLECTION = 'hotelroomlocks';

export interface RoomHoldRequest {
  /** Stored as RoomAvailability.bookingReference (see holdKeyOf). */
  holdKey: string;
  roomIds: string[];
  checkIn: Date;
  checkOut: Date;
  now: Date;
  holdExpiresAt: Date;
}

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

/**
 * Atomic, all-or-nothing room holds (HTL-18).
 *
 * HotelsService.reserveDates checks and then inserts, so two parallel
 * requests can both pass the check, and a multi-room insert is not atomic.
 * Here the check and the inserts run in ONE transaction, serialized per room
 * through lock documents: every hold first writes the lock of each of its
 * rooms, so a concurrent hold on the same room hits a write conflict, is
 * retried by the transaction helper, and then sees the winner's entries.
 * Entries use the RoomAvailability document shape, so the hotels module's
 * search, confirmDates, releaseDates and blockRoom keep working with them.
 */
@Injectable()
export class RoomInventoryService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  private get availability() {
    return this.connection.collection(AVAILABILITY_COLLECTION);
  }

  private get locks() {
    return this.connection.collection(LOCK_COLLECTION);
  }

  /**
   * Lock documents must exist before the transaction, so concurrent holds
   * conflict on them instead of racing on an upsert. Idempotent.
   */
  async ensureLocks(roomIds: string[]): Promise<void> {
    try {
      await this.locks.bulkWrite(
        roomIds.map((id) => ({
          updateOne: {
            filter: { _id: new Types.ObjectId(id) },
            update: { $setOnInsert: { seq: 0 } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      // Another request created the same lock first: that is fine.
      if (!isDuplicateKey(error)) throw error;
    }
  }

  /**
   * Holds every room for [checkIn, checkOut) or throws ConflictException and
   * writes nothing. Any overlapping entry blocks: a Confirmed ("booked"),
   * an unexpired hold ("held", expired ones are swept first) or a blocked
   * range ("maintenance"). Must run inside a transaction.
   */
  async hold(session: ClientSession, request: RoomHoldRequest): Promise<void> {
    const ids = request.roomIds.map((id) => new Types.ObjectId(id));

    await this.acquireRoomLocks(session, ids);

    const clashes = await this.availability
      .find(
        {
          roomId: { $in: ids },
          startDate: { $lt: request.checkOut },
          endDate: { $gt: request.checkIn },
          $or: [
            { status: { $in: ['booked', 'maintenance'] } },
            { status: 'held', holdExpiresAt: { $gt: request.now } },
            { status: 'held', holdExpiresAt: null },
            { status: 'held', holdExpiresAt: { $exists: false } },
          ],
        },
        { session },
      )
      .toArray();

    if (clashes.length > 0) {
      throw new ConflictException({
        message:
          'One or more rooms are no longer available for the selected dates',
        roomIds: [...new Set(clashes.map((entry) => String(entry.roomId)))],
      });
    }

    for (const roomId of ids) {
      const windows = await this.availability
        .find<{ startDate: Date; endDate: Date }>(
          {
            roomId,
            status: 'available',
          },
          { session, projection: { startDate: 1, endDate: 1 } },
        )
        .toArray();
      if (windows.length > 0 && !coversStay(windows, request.checkIn, request.checkOut)) {
        throw new ConflictException({
          message: 'A room is not bookable for the full selected date range',
          roomIds: [String(roomId)],
        });
      }
    }

    await this.availability.insertMany(
      ids.map((roomId) => ({
        roomId,
        startDate: request.checkIn,
        endDate: request.checkOut,
        status: 'held',
        bookingReference: request.holdKey,
        holdExpiresAt: request.holdExpiresAt,
        createdAt: request.now,
        updatedAt: request.now,
      })),
      { session },
    );
  }

  /** Frees every room date held or booked under `holdKey`. */
  async release(session: ClientSession, holdKey: string): Promise<void> {
    await this.availability.deleteMany(
      { bookingReference: holdKey },
      { session },
    );
  }

  async addRoomRange(
    roomId: string,
    startDate: Date,
    endDate: Date,
    status: 'available' | 'maintenance',
    now = new Date(),
  ): Promise<Types.ObjectId> {
    const roomObjectId = new Types.ObjectId(roomId);
    await this.ensureLocks([roomId]);
    let insertedId: Types.ObjectId | null = null;
    await this.connection.transaction(async (session) => {
      await this.acquireRoomLocks(session, [roomObjectId]);
      const overlap = await this.availability.findOne(
        {
          roomId: roomObjectId,
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        },
        { session, projection: { _id: 1 } },
      );
      if (overlap) {
        throw new ConflictException('Room date ranges cannot overlap');
      }
      const inserted = await this.availability.insertOne(
        {
          roomId: roomObjectId,
          startDate,
          endDate,
          status,
          createdAt: now,
          updatedAt: now,
        },
        { session },
      );
      insertedId = inserted.insertedId;
    });
    if (!insertedId) throw new Error('Room date range was not saved');
    return insertedId;
  }

  async updateRoomRange(
    roomId: string,
    rangeId: string,
    update: { startDate?: Date; endDate?: Date; status?: 'available' | 'maintenance' },
  ): Promise<void> {
    const roomObjectId = new Types.ObjectId(roomId);
    const rangeObjectId = new Types.ObjectId(rangeId);
    await this.ensureLocks([roomId]);
    await this.connection.transaction(async (session) => {
      await this.acquireRoomLocks(session, [roomObjectId]);
      const current = await this.availability.findOne(
        { _id: rangeObjectId, roomId: roomObjectId, status: { $in: ['available', 'maintenance'] } },
        { session },
      );
      if (!current) throw new ConflictException('Room date range not found');
      const startDate = update.startDate ?? (current.startDate as Date);
      const endDate = update.endDate ?? (current.endDate as Date);
      if (startDate >= endDate) {
        throw new ConflictException('Start date must be before end date');
      }
      const overlap = await this.availability.findOne(
        {
          _id: { $ne: rangeObjectId },
          roomId: roomObjectId,
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        },
        { session, projection: { _id: 1 } },
      );
      if (overlap) {
        throw new ConflictException('Room date ranges cannot overlap');
      }
      await this.availability.updateOne(
        { _id: rangeObjectId, roomId: roomObjectId },
        {
          $set: {
            startDate,
            endDate,
            status: update.status ?? current.status,
            updatedAt: new Date(),
          },
        },
        { session },
      );
    });
  }

  async acquireRoomLocks(
    session: ClientSession,
    ids: Types.ObjectId[],
  ): Promise<void> {
    await this.locks.updateMany(
      { _id: { $in: ids } },
      { $inc: { seq: 1 } },
      { session },
    );
  }
}

function coversStay(
  windows: Array<{ startDate: unknown; endDate: unknown }>,
  checkIn: Date,
  checkOut: Date,
): boolean {
  const sorted = windows
    .map((window) => ({
      start: new Date(window.startDate as Date).getTime(),
      end: new Date(window.endDate as Date).getTime(),
    }))
    .sort((a, b) => a.start - b.start);
  let cursor = checkIn.getTime();
  for (const window of sorted) {
    if (window.start > cursor) return false;
    if (window.end > cursor) cursor = window.end;
    if (cursor >= checkOut.getTime()) return true;
  }
  return false;
}