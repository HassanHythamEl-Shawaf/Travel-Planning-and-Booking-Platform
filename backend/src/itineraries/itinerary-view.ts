import type { Types } from 'mongoose';

import type { Converter } from '../fx-rates/fx-rates.service';
import {
  BUDGET_CATEGORIES,
  type BudgetCategory,
  DELETED_USER_NAME,
} from './itineraries.constants';
import type {
  Activity,
  BudgetEntry,
  Day,
  LeanItinerary,
  TransportEntry,
} from './schemas/itinerary.schema';

/**
 * Pure functions that turn a stored itinerary into what the API returns:
 * day numbers and dates (ITN-05), city groups (ITN-09) and budget totals
 * (ITN-14). Nothing here touches the database, so it is easy to unit test.
 */

// ------------------------------------------------------------------ dates

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-12-24" -> Date at midnight UTC. Dates are always handled in UTC. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Date -> "2026-12-24" (UTC). */
export function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The date `count` days after `date` (UTC, no daylight-saving surprises). */
export function addDays(date: Date, count: number): Date {
  return new Date(date.getTime() + count * DAY_MS);
}

/** Date of the day at `index` (0 = day 1), or null if there is no start date. */
export function dayDate(
  startDate: Date | undefined,
  index: number,
): string | null {
  return startDate ? toDateOnly(addDays(startDate, index)) : null;
}

// ------------------------------------------------------------------ money

/** An amount in one currency, e.g. { currency: 'EGP', amount: 1250.5 }. */
export interface Money {
  currency: string;
  amount: number;
}

/**
 * A total that may mix currencies: one amount per currency, sorted by
 * currency code. Amounts in different currencies are never added together
 * here; converting them into one currency is ITN-18's job.
 */
export interface Totals {
  amounts: Money[];
  /** ITN-18: the same total in the display currency (budget.conversion). */
  converted?: number | null;
}

/**
 * Adds amounts per currency. Works in whole cents so that 0.1 + 0.2 is
 * exactly 0.30 and totals never drift.
 */
export class MoneyBag {
  private readonly cents = new Map<string, number>();

  add(currency: string, amount: number): this {
    const value = Math.round(amount * 100);
    this.cents.set(currency, (this.cents.get(currency) ?? 0) + value);
    return this;
  }

  addBag(other: MoneyBag): this {
    for (const [currency, cents] of other.cents) {
      this.cents.set(currency, (this.cents.get(currency) ?? 0) + cents);
    }
    return this;
  }

  toTotals(): Totals {
    return {
      amounts: [...this.cents.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, cents]) => ({ currency, amount: cents / 100 })),
    };
  }
}

// ----------------------------------------------------------------- budget

/** Budget lines: the four ITN-14 categories plus intercity transport (ITN-16). */
export type BudgetLine = BudgetCategory | 'intercity_transport';

export const BUDGET_LINES: BudgetLine[] = [
  ...BUDGET_CATEGORIES,
  'intercity_transport',
];

export interface DayTotal {
  dayId: string;
  dayNumber: number;
  date: string | null;
  total: Totals;
}

/** ITN-18: which currency and rates the `converted` amounts use. */
export interface BudgetConversion {
  currency: string;
  rateDate: string;
  usingCachedRates: boolean;
}

export interface BudgetSummary {
  byCategory: Record<BudgetLine, Totals>;
  byDay: DayTotal[];
  total: Totals;
  /** null when no conversion was made (then conversionError says why). */
  conversion?: BudgetConversion | null;
  conversionError?: string | null;
}

/**
 * Everything a day costs: its budget entries, its activity costs (counted
 * under "activities") and the transport entries attached to it.
 */
function dayBags(
  day: Day,
  transport: TransportEntry[],
): Record<BudgetLine, MoneyBag> {
  const bags = Object.fromEntries(
    BUDGET_LINES.map((line) => [line, new MoneyBag()]),
  ) as Record<BudgetLine, MoneyBag>;

  for (const entry of day.budgetEntries ?? []) {
    bags[entry.category].add(entry.currency, entry.amount);
  }
  for (const activity of day.activities ?? []) {
    if (
      activity.cost !== null &&
      activity.cost !== undefined &&
      activity.currency
    ) {
      bags.activities.add(activity.currency, activity.cost);
    }
  }
  const dayId = day._id.toString();
  for (const entry of transport) {
    if (entry.dayId.toString() === dayId) {
      bags.intercity_transport.add(entry.currency, entry.amount);
    }
  }
  return bags;
}

/** One bag per day with that day's total, in day order. */
function dayTotalBags(itinerary: LeanItinerary): MoneyBag[] {
  const transport = itinerary.transportEntries ?? [];
  return (itinerary.days ?? []).map((day) => {
    const total = new MoneyBag();
    for (const bag of Object.values(dayBags(day, transport))) total.addBag(bag);
    return total;
  });
}

/** ITN-14: totals by category, by day, and overall (one amount per currency). */
export function buildBudgetSummary(itinerary: LeanItinerary): BudgetSummary {
  const days = itinerary.days ?? [];
  const transport = itinerary.transportEntries ?? [];
  const byCategory = Object.fromEntries(
    BUDGET_LINES.map((line) => [line, new MoneyBag()]),
  ) as Record<BudgetLine, MoneyBag>;
  const total = new MoneyBag();

  const byDay = days.map((day, index) => {
    const bags = dayBags(day, transport);
    const dayTotal = new MoneyBag();
    for (const line of BUDGET_LINES) {
      byCategory[line].addBag(bags[line]);
      dayTotal.addBag(bags[line]);
    }
    total.addBag(dayTotal);
    return {
      dayId: day._id.toString(),
      dayNumber: index + 1,
      date: dayDate(itinerary.startDate, index),
      total: dayTotal.toTotals(),
    };
  });

  return {
    byCategory: Object.fromEntries(
      BUDGET_LINES.map((line) => [line, byCategory[line].toTotals()]),
    ) as Record<BudgetLine, Totals>,
    byDay,
    total: total.toTotals(),
  };
}

// ------------------------------------------------------------- city groups

export interface CityGroup {
  cityId: string;
  cityName: string | null;
  firstDayNumber: number;
  lastDayNumber: number;
  dayCount: number;
  startDate: string | null;
  endDate: string | null;
  subtotal: Totals;
}

/**
 * ITN-09: consecutive days in the same city form one group, with its day
 * count, dates and budget subtotal. Cairo, Cairo, Luxor, Cairo -> 3 groups.
 */
export function buildCityGroups(
  itinerary: LeanItinerary,
  cityNames: Map<string, string>,
): CityGroup[] {
  const days = itinerary.days ?? [];
  const totals = dayTotalBags(itinerary);
  const groups: {
    cityId: string;
    first: number;
    last: number;
    bag: MoneyBag;
  }[] = [];

  days.forEach((day, index) => {
    const current = groups[groups.length - 1];
    if (current && current.cityId === day.cityId) {
      current.last = index;
      current.bag.addBag(totals[index]);
    } else {
      groups.push({
        cityId: day.cityId,
        first: index,
        last: index,
        bag: new MoneyBag().addBag(totals[index]),
      });
    }
  });

  return groups.map((g) => ({
    cityId: g.cityId,
    cityName: cityNames.get(g.cityId) ?? null,
    firstDayNumber: g.first + 1,
    lastDayNumber: g.last + 1,
    dayCount: g.last - g.first + 1,
    startDate: dayDate(itinerary.startDate, g.first),
    endDate: dayDate(itinerary.startDate, g.last),
    subtotal: g.bag.toTotals(),
  }));
}

// ------------------------------------------------------------ detail view

export interface ActivityView {
  id: string;
  name: string;
  description: string;
  time: string | null;
  cost: number | null;
  currency: string | null;
  /** ITN-18: cost in the display currency, if converted. */
  convertedCost?: number | null;
  images: { imageId: string; url: string }[];
}

export interface BudgetEntryView {
  id: string;
  category: BudgetCategory;
  amount: number;
  currency: string;
  /** ITN-18: amount in the display currency, if converted. */
  convertedAmount?: number | null;
  note: string;
}

export interface DayView {
  id: string;
  dayNumber: number;
  date: string | null;
  cityId: string;
  cityName: string | null;
  notes: string;
  activities: ActivityView[];
  budgetEntries: BudgetEntryView[];
}

export interface TransportEntryView {
  id: string;
  dayId: string;
  dayNumber: number | null;
  mode: string;
  fromCityId: string;
  fromCityName: string | null;
  toCityId: string;
  toCityName: string | null;
  amount: number;
  currency: string;
  /** ITN-18: amount in the display currency, if converted. */
  convertedAmount?: number | null;
  note: string;
}

export interface PersonRef {
  id: string | null;
  name: string;
}

export interface ItineraryView {
  id: string;
  title: string;
  countries: { code: string; name: string | null }[];
  startDate: string | null;
  endDate: string | null;
  dayCount: number;
  isPublic: boolean;
  isHidden: boolean;
  isOwner: boolean;
  author: PersonRef;
  clonedFrom: { itineraryId: string; author: PersonRef } | null;
  days: DayView[];
  cityGroups: CityGroup[];
  transportEntries: TransportEntryView[];
  budget: BudgetSummary;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** Names the presenter needs; looked up by the service in a few queries. */
export interface ViewContext {
  isOwner: boolean;
  author: { id: string; name: string; deactivated: boolean } | null;
  cloneAuthor: { name: string; deactivated: boolean } | null;
  cityNames: Map<string, string>;
  countryNames: Map<string, string>;
}

const toActivityView = (a: Activity): ActivityView => ({
  id: a._id.toString(),
  name: a.name,
  description: a.description ?? '',
  time: a.time ?? null,
  cost: a.cost ?? null,
  currency: a.currency ?? null,
  images: (a.images ?? []).map((i) => ({ imageId: i.imageId, url: i.url })),
});

const toBudgetEntryView = (e: BudgetEntry): BudgetEntryView => ({
  id: e._id.toString(),
  category: e.category,
  amount: e.amount,
  currency: e.currency,
  note: e.note ?? '',
});

/** A user as shown to others: deactivated users become "Deleted user". */
export function personRef(
  id: Types.ObjectId | string | null | undefined,
  user: { name: string; deactivated: boolean } | null,
  fallbackName = DELETED_USER_NAME,
): PersonRef {
  if (!user || user.deactivated) return { id: null, name: fallbackName };
  return { id: id ? id.toString() : null, name: user.name };
}

/** The full read-only view of an itinerary (ITN-03, ITN-21). */
export function toItineraryView(
  itinerary: LeanItinerary,
  context: ViewContext,
): ItineraryView {
  const days = itinerary.days ?? [];
  const dayNumbers = new Map(
    days.map((day, index) => [day._id.toString(), index + 1]),
  );
  const cityName = (id: string) => context.cityNames.get(id) ?? null;

  return {
    id: itinerary._id.toString(),
    title: itinerary.title,
    countries: (itinerary.countries ?? []).map((code) => ({
      code,
      name: context.countryNames.get(code) ?? null,
    })),
    startDate: itinerary.startDate ? toDateOnly(itinerary.startDate) : null,
    endDate:
      days.length > 0 ? dayDate(itinerary.startDate, days.length - 1) : null,
    dayCount: days.length,
    isPublic: itinerary.isPublic === true,
    isHidden: itinerary.isHidden === true,
    isOwner: context.isOwner,
    author: personRef(itinerary.ownerId, context.author),
    clonedFrom: itinerary.clonedFrom
      ? {
          itineraryId: itinerary.clonedFrom.itineraryId.toString(),
          author: personRef(itinerary.clonedFrom.authorId, context.cloneAuthor),
        }
      : null,
    days: days.map((day, index) => ({
      id: day._id.toString(),
      dayNumber: index + 1,
      date: dayDate(itinerary.startDate, index),
      cityId: day.cityId,
      cityName: cityName(day.cityId),
      notes: day.notes ?? '',
      activities: (day.activities ?? []).map(toActivityView),
      budgetEntries: (day.budgetEntries ?? []).map(toBudgetEntryView),
    })),
    cityGroups: buildCityGroups(itinerary, context.cityNames),
    transportEntries: (itinerary.transportEntries ?? []).map((t) => ({
      id: t._id.toString(),
      dayId: t.dayId.toString(),
      dayNumber: dayNumbers.get(t.dayId.toString()) ?? null,
      mode: t.mode,
      fromCityId: t.fromCityId,
      fromCityName: cityName(t.fromCityId),
      toCityId: t.toCityId,
      toCityName: cityName(t.toCityId),
      amount: t.amount,
      currency: t.currency,
      note: t.note ?? '',
    })),
    budget: buildBudgetSummary(itinerary),
    createdAt: itinerary.createdAt ?? null,
    updatedAt: itinerary.updatedAt ?? null,
  };
}

// ------------------------------------------------------ ITN-18 conversion

/**
 * Adds amounts in one display currency next to the original ones (ITN-18):
 * every total gets `converted`, every entry `convertedAmount` (activities:
 * `convertedCost`), and `budget.conversion` says which currency and rate
 * date were used and whether cached rates were used. Throws if a currency
 * has no rate; the caller decides what to do then.
 */
export function applyConversion(
  view: ItineraryView,
  converter: Converter,
): ItineraryView {
  // First compute every value, then write them all. If a currency has no
  // rate, convert() throws before anything is written, so the view is never
  // left half converted.
  const writes: (() => void)[] = [];
  const convertTotals = (totals: Totals) => {
    const value = converter.convertSum(totals.amounts);
    writes.push(() => (totals.converted = value));
  };

  const { budget } = view;
  for (const line of BUDGET_LINES) convertTotals(budget.byCategory[line]);
  for (const day of budget.byDay) convertTotals(day.total);
  convertTotals(budget.total);
  for (const group of view.cityGroups) convertTotals(group.subtotal);

  for (const day of view.days) {
    for (const entry of day.budgetEntries) {
      const value = converter.convert(entry.amount, entry.currency);
      writes.push(() => (entry.convertedAmount = value));
    }
    for (const activity of day.activities) {
      const value =
        activity.cost !== null && activity.currency
          ? converter.convert(activity.cost, activity.currency)
          : null;
      writes.push(() => (activity.convertedCost = value));
    }
  }
  for (const entry of view.transportEntries) {
    const value = converter.convert(entry.amount, entry.currency);
    writes.push(() => (entry.convertedAmount = value));
  }

  for (const write of writes) write();
  budget.conversion = {
    currency: converter.currency,
    rateDate: converter.rateDate,
    usingCachedRates: converter.usingCachedRates,
  };
  budget.conversionError = null;
  return view;
}

/** Every city id an itinerary mentions (days and transport entries). */
export function cityIdsOf(itinerary: LeanItinerary): string[] {
  const ids = new Set<string>();
  for (const day of itinerary.days ?? []) ids.add(day.cityId);
  for (const t of itinerary.transportEntries ?? []) {
    ids.add(t.fromCityId);
    ids.add(t.toCityId);
  }
  return [...ids];
}

/** Every activity image id, for deleting or copying files. */
export function imageIdsOf(days: Day[] | undefined): string[] {
  return (days ?? []).flatMap((day) =>
    (day.activities ?? []).flatMap((a) =>
      (a.images ?? []).map((i) => i.imageId),
    ),
  );
}
