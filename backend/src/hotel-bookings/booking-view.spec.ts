import {
  groupFilter,
  LeanHotelBooking,
  toDetails,
  toSummary,
} from './booking-view';
import { HotelBookingGroup } from './hotel-booking-group';
import { HotelBookingStatus } from './hotel-booking-status';

const NOW = new Date('2026-11-18T10:00:00Z');

const booking = (over: Record<string, unknown> = {}): LeanHotelBooking =>
  ({
    _id: 'b1',
    userId: 'u1',
    hotelId: 'h1',
    hotelName: 'Hilton Cairo',
    checkInDate: new Date('2026-12-20T00:00:00Z'),
    checkOutDate: new Date('2026-12-23T00:00:00Z'),
    nights: 3,
    rooms: [
      {
        roomId: 'r1',
        roomName: 'Deluxe',
        pricePerNight: 100,
        adults: 2,
        childrenAges: [4, 9],
        subtotal: 300,
      },
      {
        roomId: 'r2',
        roomName: 'Suite',
        pricePerNight: 150.5,
        adults: 1,
        childrenAges: [],
        subtotal: 451.5,
      },
    ],
    totalPrice: 751.5,
    currency: 'USD',
    status: HotelBookingStatus.CONFIRMED,
    holdExpiresAt: null,
    bookingReference: 'HTL-ABCD2345',
    confirmedAt: NOW,
    expiredAt: null,
    cancelledAt: null,
    completedAt: null,
    refundPercentage: null,
    refundAmount: null,
    refundId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as unknown as LeanHotelBooking;

describe('booking views (HTL-20)', () => {
  it('summarises reference, hotel, rooms, dates, guests, total and status', () => {
    expect(toSummary(booking())).toEqual({
      id: 'b1',
      bookingReference: 'HTL-ABCD2345',
      status: HotelBookingStatus.CONFIRMED,
      hotelId: 'h1',
      hotelName: 'Hilton Cairo',
      checkIn: '2026-12-20',
      checkOut: '2026-12-23',
      nights: 3,
      rooms: [
        { roomName: 'Deluxe', adults: 2, children: 2 },
        { roomName: 'Suite', adults: 1, children: 0 },
      ],
      guests: { adults: 3, children: 2 },
      totalPrice: 751.5,
      currency: 'USD',
      holdExpiresAt: null,
    });
  });

  it('has no reference before confirmation and shows the hold deadline', () => {
    const hold = new Date('2026-11-18T10:10:00Z');
    const summary = toSummary(
      booking({
        status: HotelBookingStatus.PENDING_PAYMENT,
        bookingReference: null,
        holdExpiresAt: hold,
      }),
    );
    expect(summary.bookingReference).toBeNull();
    expect(summary.holdExpiresAt).toEqual(hold);
  });

  it('gives full details with per-room guests and prices', () => {
    const details = toDetails(booking(), NOW);
    expect(details.rooms[0]).toEqual({
      roomId: 'r1',
      roomName: 'Deluxe',
      pricePerNight: 100,
      adults: 2,
      childrenAges: [4, 9],
      subtotal: 300,
    });
    expect(details.refundId).toBeNull();
  });

  it('is cancellable only when Confirmed and before the check-in date', () => {
    expect(toDetails(booking(), NOW).cancellable).toBe(true);
    expect(
      toDetails(booking(), new Date('2026-12-20T00:00:00Z')).cancellable,
    ).toBe(false);
    for (const status of [
      HotelBookingStatus.PENDING_PAYMENT,
      HotelBookingStatus.CANCELLED,
      HotelBookingStatus.EXPIRED,
      HotelBookingStatus.COMPLETED,
    ]) {
      expect(toDetails(booking({ status }), NOW).cancellable).toBe(false);
    }
  });

  it('builds a filter per group', () => {
    const upcoming = groupFilter(HotelBookingGroup.UPCOMING, NOW);
    expect(upcoming.$or).toEqual([
      { status: HotelBookingStatus.CONFIRMED, checkOutDate: { $gt: NOW } },
      {
        status: HotelBookingStatus.PENDING_PAYMENT,
        holdExpiresAt: { $gt: NOW },
      },
    ]);
    expect(groupFilter(HotelBookingGroup.PAST, NOW).$or).toEqual([
      { status: HotelBookingStatus.COMPLETED },
      { status: HotelBookingStatus.CONFIRMED, checkOutDate: { $lte: NOW } },
    ]);
    expect(groupFilter(HotelBookingGroup.CANCELLED, NOW)).toEqual({
      status: {
        $in: [HotelBookingStatus.CANCELLED, HotelBookingStatus.EXPIRED],
      },
    });
  });
});