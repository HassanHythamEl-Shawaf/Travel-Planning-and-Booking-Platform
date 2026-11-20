import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { BookingEligibilityReader } from '../users/booking-eligibility.reader';
import {
  BOOKING_COLLECTIONS,
  BOOKING_FIELDS,
  BOOKING_STATUS,
} from './teammate-contracts';

/**
 * ACC-12: a user may not deactivate their account while they have an
 * upcoming Confirmed flight or hotel booking. Reads both booking collections
 * through the team contract (teammate-contracts.ts), so the Users module
 * does not depend on the booking modules. A missing collection counts as
 * empty, so hotels are covered as soon as their bookings exist.
 */
@Injectable()
export class MongoBookingEligibilityReader implements BookingEligibilityReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async hasUpcomingConfirmedBookings(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const owner = {
      userId: new Types.ObjectId(userId),
      status: BOOKING_STATUS.CONFIRMED,
    };
    const [flight, hotel] = await Promise.all([
      // Any flight of the trip still ahead, so a round trip whose outbound
      // has departed still counts until the return flight leaves.
      this.connection
        .collection(BOOKING_COLLECTIONS.flight)
        .findOne(
          { ...owner, 'segments.departureAt': { $gt: now } },
          { projection: { _id: 1 } },
        ),
      this.connection
        .collection(BOOKING_COLLECTIONS.hotel)
        .findOne(
          { ...owner, [BOOKING_FIELDS.hotel.startsAt]: { $gt: now } },
          { projection: { _id: 1 } },
        ),
    ]);
    return flight !== null || hotel !== null;
  }
}
