import { Types } from 'mongoose';

import {
  attachBookings,
  bookingKey,
  COUNTED_STATUSES,
  type LinkedBooking,
  linksOf,
} from './itinerary-bookings';
import { toItineraryView } from './itinerary-view';
import type { LeanItinerary } from './schemas/itinerary.schema';

const flightId = new Types.ObjectId();
const hotelId = new Types.ObjectId();
const cancelledId = new Types.ObjectId();
const goneId = new Types.ObjectId();

function itinerary(): LeanItinerary {
  const link = (type: 'flight' | 'hotel', bookingId: Types.ObjectId) => ({
    _id: new Types.ObjectId(),
    type,
    bookingId,
  });
  return {
    _id: new Types.ObjectId(),
    ownerId: new Types.ObjectId(),
    title: 'Trip',
    countries: ['EG'],
    startDate: new Date('2027-01-05T00:00:00Z'),
    days: [
      {
        _id: new Types.ObjectId(),
        cityId: 'cairo',
        notes: '',
        activities: [],
        budgetEntries: [
          {
            _id: new Types.ObjectId(),
            category: 'food',
            amount: 100,
            currency: 'USD',
            note: '',
          },
        ],
        bookingLinks: [link('flight', flightId), link('flight', cancelledId)],
      },
      {
        _id: new Types.ObjectId(),
        cityId: 'luxor',
        notes: '',
        activities: [],
        budgetEntries: [],
        bookingLinks: [link('hotel', hotelId), link('hotel', goneId)],
      },
      // An older day stored before ITN-27 has no bookingLinks at all.
      {
        _id: new Types.ObjectId(),
        cityId: 'aswan',
        notes: '',
        activities: [],
        budgetEntries: [],
      },
    ],
    transportEntries: [],
  } as LeanItinerary;
}

const booking = (
  type: 'flight' | 'hotel',
  id: Types.ObjectId,
  status: string,
  totalPrice: number,
): [string, LinkedBooking] => [
  bookingKey(type, id.toString()),
  {
    type,
    bookingId: id.toString(),
    status,
    bookingReference: 'REF',
    totalPrice,
    currency: 'USD',
    startsAt: new Date('2027-01-05T06:00:00Z'),
    providerName: type === 'flight' ? 'Nile Air' : 'Luxor Palace',
  },
];

function view(it: LeanItinerary) {
  return toItineraryView(it, {
    isOwner: true,
    author: { id: 'a', name: 'A', deactivated: false },
    cloneAuthor: null,
    cityNames: new Map(),
    countryNames: new Map(),
  });
}

describe('linked bookings (ITN-27)', () => {
  const bookings = new Map([
    booking('flight', flightId, 'Confirmed', 250.1),
    booking('flight', cancelledId, 'Cancelled', 999),
    booking('hotel', hotelId, 'Completed', 400.2),
  ]);

  it('counts only Confirmed and Completed bookings', () => {
    expect(COUNTED_STATUSES).toEqual(['Confirmed', 'Completed']);
    const it = itinerary();
    const result = attachBookings(view(it), it, bookings);

    expect(result.days[0].bookings.map((b) => [b.status, b.counted])).toEqual([
      ['Confirmed', true],
      ['Cancelled', false],
    ]);
    // A booking that no longer exists is shown, but not counted.
    expect(result.days[1].bookings[1]).toMatchObject({
      bookingId: goneId.toString(),
      status: null,
      counted: false,
      totalPrice: null,
    });
    expect(result.days[2].bookings).toEqual([]);
  });

  it('feeds the budget per day, per type and in total, in cents', () => {
    const it = itinerary();
    const { budget } = attachBookings(view(it), it, bookings);

    expect(budget.byDay.map((d) => d.bookings.amounts)).toEqual([
      [{ currency: 'USD', amount: 250.1 }],
      [{ currency: 'USD', amount: 400.2 }],
      [],
    ]);
    expect(budget.bookings.flight.amounts).toEqual([
      { currency: 'USD', amount: 250.1 },
    ]);
    expect(budget.bookings.hotel.amounts).toEqual([
      { currency: 'USD', amount: 400.2 },
    ]);
    expect(budget.bookings.total.amounts).toEqual([
      { currency: 'USD', amount: 650.3 },
    ]);
    // Planned costs are unchanged; the combined total adds the bookings.
    expect(budget.total.amounts).toEqual([{ currency: 'USD', amount: 100 }]);
    expect(budget.totalWithBookings.amounts).toEqual([
      { currency: 'USD', amount: 750.3 },
    ]);
    // Booking prices are never converted (PAY-04).
    expect(budget.bookings.total.converted).toBeUndefined();
    expect(budget.totalWithBookings.converted).toBeUndefined();
  });

  it('starts empty for everyone, so other viewers never see bookings', () => {
    const plain = view(itinerary());
    expect(plain.days.every((d) => d.bookings.length === 0)).toBe(true);
    expect(plain.budget.bookings.total.amounts).toEqual([]);
    expect(plain.budget.totalWithBookings.amounts).toEqual([
      { currency: 'USD', amount: 100 },
    ]);
  });

  it('lists every link in day order', () => {
    expect(linksOf(itinerary()).map(({ link }) => link.type)).toEqual([
      'flight',
      'flight',
      'hotel',
      'hotel',
    ]);
  });
});
