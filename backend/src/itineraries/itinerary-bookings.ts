import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import {
  BOOKING_COLLECTIONS,
  BOOKING_FIELDS,
  BOOKING_STATUS,
  PROVIDER_COLLECTIONS,
} from '../integrations/teammate-contracts';
import type { BookingLinkView, ItineraryView } from './itinerary-view';
import { MoneyBag } from './itinerary-view';
import type { BookingLinkType } from './itineraries.constants';
import type { LeanItinerary } from './schemas/itinerary.schema';

/**
 * ITN-27 (bonus): booked flights and hotels linked to itinerary days.
 *
 * Bookings belong to Arafa (flights, Person 4) and Yassin (hotels,
 * Person 6). They are read only through the fields the team agreed in
 * integrations/teammate-contracts.ts, the same way admin booking
 * inspection reads them, so no teammate file is changed and hotel bookings
 * work as soon as that module stores them under the agreed names.
 */

/** What the itinerary needs from a booking (contract fields only). */
export interface LinkedBooking {
  type: BookingLinkType;
  bookingId: string;
  status: string;
  bookingReference: string | null;
  totalPrice: number;
  currency: string;
  /** Flight: outbound departure (UTC). Hotel: check-in date. */
  startsAt: Date | null;
  /** Airline or hotel name. */
  providerName: string | null;
}

/** Only these statuses count in the budget and can be linked. */
export const COUNTED_STATUSES: readonly string[] = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.COMPLETED,
];

/** Booking type -> provider kind in PROVIDER_COLLECTIONS. */
const PROVIDER_OF = { flight: 'airline', hotel: 'hotel' } as const;

export const bookingKey = (type: string, bookingId: string): string =>
  `${type}:${bookingId}`;

/** Every link in the itinerary, in day order. */
export function linksOf(itinerary: LeanItinerary) {
  return (itinerary.days ?? []).flatMap((day) =>
    (day.bookingLinks ?? []).map((link) => ({ day, link })),
  );
}

/**
 * Fills the owner's view with the linked bookings (ITN-27): each day's
 * `bookings`, `budget.byDay[].bookings`, `budget.bookings` and
 * `budget.totalWithBookings`. Only Confirmed and Completed bookings count.
 * Booking prices stay in their own currency and get no converted value.
 */
export function attachBookings(
  view: ItineraryView,
  itinerary: LeanItinerary,
  bookings: ReadonlyMap<string, LinkedBooking>,
): ItineraryView {
  const byType = { flight: new MoneyBag(), hotel: new MoneyBag() };
  const total = new MoneyBag();

  (itinerary.days ?? []).forEach((day, index) => {
    const dayBag = new MoneyBag();
    view.days[index].bookings = (day.bookingLinks ?? []).map(
      (link): BookingLinkView => {
        const bookingId = link.bookingId.toString();
        const booking = bookings.get(bookingKey(link.type, bookingId));
        const counted = !!booking && COUNTED_STATUSES.includes(booking.status);
        if (booking && counted) {
          byType[link.type].add(booking.currency, booking.totalPrice);
          dayBag.add(booking.currency, booking.totalPrice);
        }
        return {
          id: link._id.toString(),
          type: link.type,
          bookingId,
          status: booking?.status ?? null,
          counted,
          bookingReference: booking?.bookingReference ?? null,
          providerName: booking?.providerName ?? null,
          startsAt: booking?.startsAt ? booking.startsAt.toISOString() : null,
          totalPrice: booking ? booking.totalPrice : null,
          currency: booking?.currency ?? null,
        };
      },
    );
    view.budget.byDay[index].bookings = dayBag.toTotals();
    total.addBag(dayBag);
  });

  view.budget.bookings = {
    flight: byType.flight.toTotals(),
    hotel: byType.hotel.toTotals(),
    total: total.toTotals(),
  };
  view.budget.totalWithBookings = new MoneyBag()
    .addAll(view.budget.total.amounts)
    .addBag(total)
    .toTotals();
  return view;
}

type RawBooking = Record<string, unknown> & { _id: Types.ObjectId };

/** Reads the owner's bookings through the team contract (never writes). */
@Injectable()
export class ItineraryBookingsReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * The given bookings that belong to `ownerId`, keyed by bookingKey().
   * Someone else's booking, or an unknown id, is simply absent.
   */
  async findOwned(
    ownerId: string | Types.ObjectId,
    refs: { type: BookingLinkType; bookingId: string | Types.ObjectId }[],
  ): Promise<Map<string, LinkedBooking>> {
    const found = new Map<string, LinkedBooking>();
    const owner = new Types.ObjectId(ownerId.toString());

    for (const type of ['flight', 'hotel'] as const) {
      const ids = refs
        .filter((r) => r.type === type)
        .map((r) => r.bookingId.toString())
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      if (ids.length === 0) continue;

      const fields = BOOKING_FIELDS[type];
      const rows = await this.connection
        .collection(BOOKING_COLLECTIONS[type])
        .find(
          { _id: { $in: ids }, userId: owner },
          {
            projection: {
              status: 1,
              bookingReference: 1,
              totalPrice: 1,
              currency: 1,
              [fields.providerId]: 1,
              [fields.startsAt]: 1,
            },
          },
        )
        .toArray();
      const providerIds = rows
        .map((r) => r[fields.providerId])
        .filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
      const providers = providerIds.length
        ? await this.connection
            .collection(PROVIDER_COLLECTIONS[PROVIDER_OF[type]])
            .find({ _id: { $in: providerIds } }, { projection: { name: 1 } })
            .toArray()
        : [];
      const names = new Map(
        providers.map((p) => [p._id.toString(), String(p.name ?? '')]),
      );

      for (const row of rows as RawBooking[]) {
        const providerId = row[fields.providerId];
        const startsAt = row[fields.startsAt];
        found.set(bookingKey(type, row._id.toString()), {
          type,
          bookingId: row._id.toString(),
          status: String(row.status ?? ''),
          bookingReference:
            typeof row.bookingReference === 'string'
              ? row.bookingReference
              : null,
          totalPrice: typeof row.totalPrice === 'number' ? row.totalPrice : 0,
          currency: typeof row.currency === 'string' ? row.currency : '',
          startsAt: startsAt instanceof Date ? startsAt : null,
          providerName: providerId
            ? (names.get(String(providerId)) ?? null)
            : null,
        });
      }
    }
    return found;
  }
}
