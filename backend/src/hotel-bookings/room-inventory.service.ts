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

    await this.locks.updateMany(
      { _id: { $in: ids } },
      { $inc: { seq: 1 } },
      { session },
    );

    const clashes = await this.availability
      .find(
        {
          roomId: { $in: ids },
          startDate: { $lt: request.checkOut },
          endDate: { $gt: request.checkIn },
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

    await this.availability.insertMany(
      ids.map((roomId) => ({
        roomId,
        startDate: request.checkIn,
        endDate: request.checkOut,
        status: 'held',
        bookingReference: request.holdKey,
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
}