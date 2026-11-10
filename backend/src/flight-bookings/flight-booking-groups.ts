import type { QueryFilter } from 'mongoose';

import { FlightBookingGroup } from './dto/list-flight-bookings.dto';
import { FlightBookingStatus } from './flight-booking-status';
import type { FlightBooking } from './schemas/flight-booking.schema';

/**
 * FLT-25 groups as MongoDB filters. Together they cover every status exactly
 * once, judged at `now`, so a booking never shows in two tabs or none:
 *
 * - upcoming:  Confirmed, outbound not departed | Pending Payment, hold running
 * - past:      Completed | Confirmed, outbound departed (before the cron marks it Completed)
 * - cancelled: Cancelled | Expired | Pending Payment, hold ran out (before the cron expires it)
 *
 * "Departed" uses the outbound segment, the same instant that decides
 * whether a booking can still be cancelled (FLT-26).
 */
export function groupFilter(
  group: FlightBookingGroup,
  now: Date,
): QueryFilter<FlightBooking> {
  switch (group) {
    case FlightBookingGroup.UPCOMING:
      return {
        $or: [
          { status: FlightBookingStatus.CONFIRMED, departureAt: { $gt: now } },
          {
            status: FlightBookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: now },
          },
        ],
      };
    case FlightBookingGroup.PAST:
      return {
        $or: [
          { status: FlightBookingStatus.COMPLETED },
          { status: FlightBookingStatus.CONFIRMED, departureAt: { $lte: now } },
        ],
      };
    case FlightBookingGroup.CANCELLED:
      return {
        $or: [
          {
            status: {
              $in: [FlightBookingStatus.CANCELLED, FlightBookingStatus.EXPIRED],
            },
          },
          {
            status: FlightBookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $lte: now },
          },
        ],
      };
  }
}

/** Soonest trip first for upcoming; most recent first otherwise. */
export function groupSort(group: FlightBookingGroup): Record<string, 1 | -1> {
  switch (group) {
    case FlightBookingGroup.UPCOMING:
      return { departureAt: 1, _id: 1 };
    case FlightBookingGroup.PAST:
      return { departureAt: -1, _id: -1 };
    case FlightBookingGroup.CANCELLED:
      return { updatedAt: -1, _id: -1 };
  }
}
