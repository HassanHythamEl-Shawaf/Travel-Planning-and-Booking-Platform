import type { Types } from 'mongoose';

import { HotelBookingGroup } from './hotel-booking-group';
import { HotelBookingStatus } from './hotel-booking-status';
import type { HotelBooking } from './schemas/hotel-booking.schema';

/** A booking read with .lean(). */
export type LeanHotelBooking = HotelBooking & { _id: Types.ObjectId };

const dateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Which bookings belong to which tab (HTL-20, GEN-11):
 * - upcoming: Confirmed and not yet checked out (a stay in progress still
 *   counts), or Pending Payment with a running hold;
 * - past: Completed, or Confirmed after check-out;
 * - cancelled: Cancelled or Expired.
 * A Pending Payment booking whose hold already ran out belongs to no tab until
 * the expiry job marks it Expired.
 */
export function groupFilter(
  group: HotelBookingGroup,
  now: Date,
): Record<string, unknown> {
  switch (group) {
    case HotelBookingGroup.UPCOMING:
      return {
        $or: [
          {
            status: HotelBookingStatus.CONFIRMED,
            checkOutDate: { $gt: now },
          },
          {
            status: HotelBookingStatus.PENDING_PAYMENT,
            holdExpiresAt: { $gt: now },
          },
        ],
      };
    case HotelBookingGroup.PAST:
      return {
        $or: [
          { status: HotelBookingStatus.COMPLETED },
          {
            status: HotelBookingStatus.CONFIRMED,
            checkOutDate: { $lte: now },
          },
        ],
      };
    case HotelBookingGroup.CANCELLED:
      return {
        status: {
          $in: [HotelBookingStatus.CANCELLED, HotelBookingStatus.EXPIRED],
        },
      };
  }
}

/** Soonest stay first for upcoming; most recent first for the other tabs. */
export const GROUP_SORT: Record<HotelBookingGroup, Record<string, 1 | -1>> = {
  [HotelBookingGroup.UPCOMING]: { checkInDate: 1, _id: 1 },
  [HotelBookingGroup.PAST]: { checkInDate: -1, _id: -1 },
  [HotelBookingGroup.CANCELLED]: { updatedAt: -1, _id: -1 },
};

export interface HotelBookingSummary {
  id: string;
  /** null until the booking is confirmed. */
  bookingReference: string | null;
  status: HotelBookingStatus;
  hotelId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: { roomName: string; adults: number; children: number }[];
  guests: { adults: number; children: number };
  totalPrice: number;
  currency: string;
  /** Pay before this instant (Pending Payment only). */
  holdExpiresAt: Date | null;
}

export interface HotelBookingDetails
  extends Omit<HotelBookingSummary, 'rooms'> {
  rooms: {
    roomId: string;
    roomName: string;
    pricePerNight: number;
    adults: number;
    childrenAges: number[];
    subtotal: number;
  }[];
  /** Confirmed and before the check-in date (the cancel button's condition). */
  cancellable: boolean;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  completedAt: Date | null;
  refundPercentage: number | null;
  refundAmount: number | null;
  refundId: string | null;
}

export function toSummary(booking: LeanHotelBooking): HotelBookingSummary {
  const rooms = booking.rooms.map((room) => ({
    roomName: room.roomName,
    adults: room.adults,
    children: room.childrenAges?.length ?? 0,
  }));
  return {
    id: String(booking._id),
    bookingReference: booking.bookingReference ?? null,
    status: booking.status,
    hotelId: String(booking.hotelId),
    hotelName: booking.hotelName,
    checkIn: dateOnly(booking.checkInDate),
    checkOut: dateOnly(booking.checkOutDate),
    nights: booking.nights,
    rooms,
    guests: {
      adults: rooms.reduce((sum, room) => sum + room.adults, 0),
      children: rooms.reduce((sum, room) => sum + room.children, 0),
    },
    totalPrice: booking.totalPrice,
    currency: booking.currency,
    holdExpiresAt: booking.holdExpiresAt ?? null,
  };
}

export function toDetails(
  booking: LeanHotelBooking,
  now: Date,
): HotelBookingDetails {
  return {
    ...toSummary(booking),
    rooms: booking.rooms.map((room) => ({
      roomId: String(room.roomId),
      roomName: room.roomName,
      pricePerNight: room.pricePerNight,
      adults: room.adults,
      childrenAges: room.childrenAges ?? [],
      subtotal: room.subtotal,
    })),
    cancellable:
      booking.status === HotelBookingStatus.CONFIRMED &&
      now.getTime() < booking.checkInDate.getTime(),
    createdAt: booking.createdAt,
    confirmedAt: booking.confirmedAt ?? null,
    cancelledAt: booking.cancelledAt ?? null,
    expiredAt: booking.expiredAt ?? null,
    completedAt: booking.completedAt ?? null,
    refundPercentage: booking.refundPercentage ?? null,
    refundAmount: booking.refundAmount ?? null,
    refundId: booking.refundId ?? null,
  };
}