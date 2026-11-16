/** Limits and fixed values for itineraries (ITN-01 to ITN-21). */

export const ITINERARY_TITLE_MAX = 100;
export const MAX_COUNTRIES = 30;
/** ITN-05: an itinerary has at most 60 days. */
export const MAX_DAYS = 60;
export const DAY_NOTES_MAX = 1000;

export const ACTIVITY_NAME_MAX = 100;
export const ACTIVITY_DESCRIPTION_MAX = 1000;
export const MAX_ACTIVITIES_PER_DAY = 20;
export const MAX_BUDGET_ENTRIES_PER_DAY = 30;
export const MAX_TRANSPORT_ENTRIES = 100;
export const ENTRY_NOTE_MAX = 200;
/** Largest amount accepted for any cost (in its currency). */
export const MAX_AMOUNT = 100_000_000;

/** ITN-14 budget categories. Intercity transport is separate (ITN-16). */
export const BUDGET_CATEGORIES = [
  'food',
  'accommodation',
  'in_city_transport',
  'activities',
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

/** ITN-16 intercity transport modes. */
export const TRANSPORT_MODES = [
  'flight',
  'train',
  'bus',
  'car',
  'ferry',
  'other',
] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

/** Shown instead of the name of a deactivated author. */
export const DELETED_USER_NAME = 'Deleted user';

/** Note on reports closed because the owner deleted the itinerary. */
export const DELETED_BY_OWNER_NOTE = 'Deleted by owner';

/** Read-modify-write attempts before answering 409 (spec D9). */
export const MAX_SAVE_ATTEMPTS = 12;

/** Date-only strings, e.g. 2026-12-24. */
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** 24-hour local time, e.g. 09:30. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;
