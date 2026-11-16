import { Types } from 'mongoose';

import {
  addDays,
  buildBudgetSummary,
  buildCityGroups,
  MoneyBag,
  parseDateOnly,
  toDateOnly,
  toItineraryView,
  type ViewContext,
} from './itinerary-view';
import type {
  Day,
  LeanItinerary,
  TransportEntry,
} from './schemas/itinerary.schema';

const id = () => new Types.ObjectId();

function day(cityId: string, extra: Partial<Day> = {}): Day {
  return {
    _id: id(),
    cityId,
    notes: '',
    activities: [],
    budgetEntries: [],
    ...extra,
  };
}

function itinerary(
  days: Day[],
  transportEntries: TransportEntry[] = [],
): LeanItinerary {
  return {
    _id: id(),
    ownerId: id(),
    title: 'Egypt',
    countries: ['EG'],
    startDate: parseDateOnly('2026-12-30'),
    days,
    transportEntries,
  };
}

const transport = (
  dayId: Types.ObjectId,
  amount: number,
  currency = 'EGP',
): TransportEntry => ({
  _id: id(),
  dayId,
  mode: 'train',
  fromCityId: 'cairo',
  toCityId: 'luxor',
  amount,
  currency,
  note: '',
});

const context: ViewContext = {
  isOwner: true,
  author: { id: 'u1', name: 'Hammad', deactivated: false },
  cloneAuthor: null,
  cityNames: new Map([
    ['cairo', 'Cairo'],
    ['luxor', 'Luxor'],
  ]),
  countryNames: new Map([['EG', 'Egypt']]),
};

describe('dates (ITN-05)', () => {
  it('works in UTC across month, year and daylight-saving changes', () => {
    expect(toDateOnly(addDays(parseDateOnly('2026-12-30'), 3))).toBe(
      '2027-01-02',
    );
    expect(toDateOnly(addDays(parseDateOnly('2028-02-28'), 1))).toBe(
      '2028-02-29',
    );
    // Clocks change in late March / October in many time zones.
    expect(toDateOnly(addDays(parseDateOnly('2026-03-28'), 2))).toBe(
      '2026-03-30',
    );
    expect(toDateOnly(addDays(parseDateOnly('2026-10-24'), 2))).toBe(
      '2026-10-26',
    );
  });

  it('numbers days by position and dates them from the start date', () => {
    const view = toItineraryView(
      itinerary([day('cairo'), day('cairo'), day('luxor')]),
      context,
    );
    expect(view.days.map((d) => [d.dayNumber, d.date])).toEqual([
      [1, '2026-12-30'],
      [2, '2026-12-31'],
      [3, '2027-01-01'],
    ]);
    expect(view.endDate).toBe('2027-01-01');
    expect(view.dayCount).toBe(3);
  });
});

describe('MoneyBag', () => {
  it('adds in whole cents, per currency', () => {
    const bag = new MoneyBag().add('USD', 0.1).add('USD', 0.2).add('EGP', 5);
    expect(bag.toTotals()).toEqual({
      amounts: [
        { currency: 'EGP', amount: 5 },
        { currency: 'USD', amount: 0.3 },
      ],
    });
  });
});

describe('city groups (ITN-09)', () => {
  it('groups consecutive days in the same city with day count, dates and subtotal', () => {
    const d1 = day('cairo', {
      budgetEntries: [
        { _id: id(), category: 'food', amount: 100, currency: 'EGP', note: '' },
      ],
    });
    const d2 = day('cairo', {
      activities: [
        {
          _id: id(),
          name: 'Museum',
          description: '',
          time: '10:00',
          cost: 50,
          currency: 'EGP',
          images: [],
        },
      ],
    });
    const d3 = day('luxor');
    const d4 = day('cairo');
    const groups = buildCityGroups(
      itinerary([d1, d2, d3, d4], [transport(d3._id, 300)]),
      context.cityNames,
    );

    expect(groups).toEqual([
      {
        cityId: 'cairo',
        cityName: 'Cairo',
        firstDayNumber: 1,
        lastDayNumber: 2,
        dayCount: 2,
        startDate: '2026-12-30',
        endDate: '2026-12-31',
        subtotal: { amounts: [{ currency: 'EGP', amount: 150 }] },
      },
      expect.objectContaining({
        cityId: 'luxor',
        dayCount: 1,
        subtotal: { amounts: [{ currency: 'EGP', amount: 300 }] },
      }),
      expect.objectContaining({
        cityId: 'cairo',
        firstDayNumber: 4,
        dayCount: 1,
      }),
    ]);
  });

  it('is empty for an itinerary without days (e.g. an older raw document)', () => {
    expect(
      buildCityGroups(
        { _id: id(), ownerId: id(), title: 'Bare' },
        context.cityNames,
      ),
    ).toEqual([]);
  });
});

describe('budget (ITN-14, ITN-16)', () => {
  it('totals by category, by day and overall; activity costs count as activities', () => {
    const d1 = day('cairo', {
      budgetEntries: [
        {
          _id: id(),
          category: 'food',
          amount: 100.5,
          currency: 'EGP',
          note: '',
        },
        {
          _id: id(),
          category: 'accommodation',
          amount: 80,
          currency: 'USD',
          note: '',
        },
        {
          _id: id(),
          category: 'in_city_transport',
          amount: 20,
          currency: 'EGP',
          note: '',
        },
      ],
      activities: [
        {
          _id: id(),
          name: 'Tour',
          description: '',
          time: null,
          cost: 30,
          currency: 'USD',
          images: [],
        },
        {
          _id: id(),
          name: 'Walk',
          description: '',
          time: null,
          cost: null,
          currency: null,
          images: [],
        },
      ],
    });
    const d2 = day('luxor', {
      budgetEntries: [
        {
          _id: id(),
          category: 'activities',
          amount: 10,
          currency: 'USD',
          note: '',
        },
      ],
    });
    const summary = buildBudgetSummary(
      itinerary([d1, d2], [transport(d2._id, 400)]),
    );

    expect(summary.byCategory).toEqual({
      food: { amounts: [{ currency: 'EGP', amount: 100.5 }] },
      accommodation: { amounts: [{ currency: 'USD', amount: 80 }] },
      in_city_transport: { amounts: [{ currency: 'EGP', amount: 20 }] },
      activities: { amounts: [{ currency: 'USD', amount: 40 }] },
      intercity_transport: { amounts: [{ currency: 'EGP', amount: 400 }] },
    });
    expect(summary.byDay.map((d) => [d.dayNumber, d.total.amounts])).toEqual([
      [
        1,
        [
          { currency: 'EGP', amount: 120.5 },
          { currency: 'USD', amount: 110 },
        ],
      ],
      [
        2,
        [
          { currency: 'EGP', amount: 400 },
          { currency: 'USD', amount: 10 },
        ],
      ],
    ]);
    expect(summary.total.amounts).toEqual([
      { currency: 'EGP', amount: 520.5 },
      { currency: 'USD', amount: 120 },
    ]);
  });

  it('keeps a transport entry on its day when days are moved', () => {
    const cairo = day('cairo');
    const luxor = day('luxor');
    const entry = transport(luxor._id, 250);

    const before = toItineraryView(itinerary([cairo, luxor], [entry]), context);
    expect(before.transportEntries[0].dayNumber).toBe(2);

    // Move Luxor to the front: the entry moves with it.
    const after = toItineraryView(itinerary([luxor, cairo], [entry]), context);
    expect(after.transportEntries[0].dayNumber).toBe(1);
    expect(after.budget.byDay[0].total.amounts).toEqual([
      { currency: 'EGP', amount: 250 },
    ]);
  });
});

describe('toItineraryView', () => {
  it('credits a deactivated author as "Deleted user"', () => {
    const view = toItineraryView(itinerary([]), {
      ...context,
      author: { id: 'u1', name: 'Old Name', deactivated: true },
    });
    expect(view.author).toEqual({ id: null, name: 'Deleted user' });
  });

  it('copes with documents that only have the contract fields', () => {
    const view = toItineraryView(
      { _id: id(), ownerId: id(), title: 'Bare', isPublic: true },
      context,
    );
    expect(view).toMatchObject({
      title: 'Bare',
      countries: [],
      startDate: null,
      endDate: null,
      dayCount: 0,
      isPublic: true,
      isHidden: false,
      days: [],
    });
  });
});
