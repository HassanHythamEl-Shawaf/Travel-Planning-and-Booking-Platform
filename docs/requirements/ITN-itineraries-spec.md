# Spec: Itineraries (days, activities, budget, public itineraries)

**Requirements:** ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-09, ITN-10, ITN-12, ITN-14, ITN-16, ITN-20, ITN-21, ITN-25, ITN-26. Related: ACC-11, ACC-12, GEN-03, GEN-05, GEN-08, GEN-09, GEN-10, BLG-12, HTL-11, FLT-11, FLT-12. ITN-18 (exchange rates) is in `ITN-18-fx-rates-spec.md`.
**Owner:** Hammad (Person 8)
**Authority:** the official requirements sheet wins over this spec.

## 1. Requirements (from the sheet)

| ID | Rule |
|---|---|
| ITN-01 | Create an itinerary with a required title (max 100), one or more countries from a predefined list and a start date; edit them; delete it after confirmation. Private by default. When deleted it disappears from public search; clones made by others are unaffected. |
| ITN-03 | List my itineraries (title, countries, start date, days, visibility), most recently updated first, and open any to see its details. |
| ITN-05 | Add days and edit each day's city (predefined list shared with hotels and airports) and notes. Days are numbered sequentially, dates derive from the start date, at most 60 days. |
| ITN-07 | Delete a day after confirmation. Remaining days are renumbered; dates and budget totals recalculated. |
| ITN-08 | Move a day; days renumbered, dates and groupings recalculated. |
| ITN-09 | Each day has a city; consecutive days in the same city form a group with its day count and budget subtotal. |
| ITN-10 | Add, edit and delete activities: name, description, optional time, optional cost. |
| ITN-12 | Attach images to and remove images from an activity under GEN-08. |
| ITN-14 | Non-negative budget entries per day for food, accommodation, in-city transport and activities in a selected currency; totals by category and by day, including activity costs (as Activities) and intercity transport (ITN-16). |
| ITN-16 | Add, edit and delete transport cost entries (mode, from-city, to-city, amount, currency, day). |
| ITN-20 | Public or Private. Public: in shared search, read-only to others. Private: removed immediately. |
| ITN-21 | Guests and users search public itineraries by keyword (title, country, city), filter by duration and by country or city, and view one read-only with author, days, activities and budget. A registered user may clone it: all days, activities and budgets, private, credits the original author, independent. |

## 2. Decisions

| # | Decision |
|---|---|
| D1 | One Mongoose model `Itinerary` (collection `itineraries`) with the contract fields of `ITINERARY_FIELDS` (`ownerId` ObjectId, `title`, `isPublic`, `isHidden`, `countries` string[], `createdAt`). Days are embedded in order; each day embeds its activities and budget entries; transport entries are a separate array on the itinerary. One document per itinerary keeps every change atomic. |
| D2 | `countries` are country codes checked against the seeded reference data (duplicates removed). A day's `cityId` and transport from/to cities are checked against the city list. A day's city does **not** have to belong to one of the itinerary's countries, so editing the countries never invalidates days. |
| D3 | Dates are date-only strings (`YYYY-MM-DD`). `startDate` is stored as midnight UTC, and all day arithmetic is done in UTC, so time zones and daylight saving never shift a date. |
| D4 | Day numbers and dates are **never stored**: day N is at position N−1 and its date is `startDate + (N−1) days`. Adding, deleting or moving a day, or changing the start date, renumbers and re-dates everything automatically. Days have a stable `_id`. |
| D5 | Who can see an itinerary: the owner always. Private: nobody else (admins too get 404, like Blog drafts). Public: everyone including guests, read-only. Hidden (GEN-10): owner and admins only. Public by a deactivated owner (ACC-12): admins only. Suspended owners stay visible. Anyone who can't see it gets 404; a non-owner who can see it gets 403 on any write. |
| D6 | Only `user` accounts create or clone itineraries (`RolesGuard`, like Blog). |
| D7 | Deleting a day (ITN-07) also deletes the transport entries attached to it and its activities' image files (after the save). A transport entry belongs to one day, so it has no meaning without it. |
| D8 | Transport entries reference their day by its stable `_id`, never by number, so they stay on the right day when days move. `dayId` must be a day of the same itinerary. |
| D9 | Concurrency: every change to days or entries is a read-modify-write that saves only `days`, `transportEntries` and `version`, and only if `version` is unchanged. Otherwise it reloads and retries (random 5–25 ms wait), up to 12 times, then answers **409**. It never overwrites `isHidden`, `isPublic` or other fields. The 60-day and 5-image limits are checked inside the loop, so parallel requests can't exceed them. |
| D10 | Itinerary-level edits (title, countries, start date, visibility) are plain `$set`s on those fields only. |
| D11 | Limits: 60 days (sheet); 20 activities and 30 budget entries per day; 100 transport entries per itinerary; title 100, notes 1,000, activity name 100 / description 1,000, entry note 200 characters; amounts 0–100,000,000 with at most 2 decimals; activity time `HH:mm`. |
| D12 | Activity cost is optional, but `cost` and `currency` are set together (400 otherwise). Sending `cost: null` clears both; `time: null` clears the time. |
| D13 | Currencies (budget entries, activity costs, transport) must be in the supported list seeded from Countries.csv (400 otherwise). |
| D14 | Totals (ITN-14): `budget.byCategory` has `food`, `accommodation`, `in_city_transport`, `activities` (budget entries plus activity costs) and `intercity_transport`; `budget.byDay` has each day's total, including the transport entries attached to that day; `budget.total` is the overall total. Each total is `{ amounts: [{ currency, amount }] }`, one amount per currency. Different currencies are never added together here; ITN-18 adds converted totals next to these fields. Sums are done in whole cents, so they don't drift. |
| D15 | City groups (ITN-09): consecutive days with the same `cityId` form one group with `firstDayNumber`, `lastDayNumber`, `dayCount`, `startDate`, `endDate` and `subtotal` (the days' totals). Cairo, Cairo, Luxor, Cairo gives 3 groups. |
| D16 | Confirmation (GEN-03): deleting an itinerary or a day needs `{ "confirm": true }`. Deleting an activity, an image or an entry does not; they are small and easy to add again. |
| D17 | Owner delete (ITN-01) is one transaction: the itinerary is deleted and its open reports are closed as `content_deleted` with `resolvedBy: null` and the note `Deleted by owner` (as Blog does). Image files are deleted after the commit. Clones are separate documents and are not touched. |
| D18 | Every write returns the whole updated itinerary (the same shape as `GET /:id`), so the client never has to recompute numbers, dates, groups or totals. |
| D19 | `GET /:id` returns all days (at most 60) with their activities and entries in one response; it is one resource, not a list (GEN-05 pagination applies to the two lists below). |
| D20 | `GET /mine` (ITN-03): the owner's itineraries, hidden ones included with `isHidden: true`, sorted by `updatedAt` then `_id` descending, 10 per page. |
| D21 | Public search (ITN-21): `isPublic` and not hidden and owner not deactivated. `q` (≤100) is escaped and matched case-insensitively against the title, country names (or an exact country code), and city names (via the itineraries' day cities). Filters: `country` (code), `cityId` (some day there), `minDays` / `maxDays` (0–60, min ≤ max). Newest first (`createdAt`, `_id`), 10 per page. |
| D22 | Clone (ITN-21): any user who can see the itinerary may clone it. The clone gets new ids for days, activities and entries; transport entries are re-attached to the new day ids; images are copied as new files. It is private, never hidden, and `clonedFrom` holds the original's id, author id and the author's name at that time. A clone of a clone credits the author of the itinerary that was copied. A deactivated original author is shown as "Deleted user". If saving fails, the copied files are deleted. |
| D23 | Moderation (GEN-09 / GEN-10): an `itinerary` handler replaces the raw default. `find` tolerates documents with only the contract fields; `publiclyVisible = isPublic && !isHidden`; snapshot excerpt = title; `assets` = activity image ids, deleted in `afterDelete`. `setHidden` is conditional on the current state. |
| D24 | Activity images (ITN-12): the file is stored once (outside the save loop), then attached with the 5-per-activity check inside the loop. If attaching fails (limit reached by a parallel upload, activity deleted meanwhile, 409), the stored file is deleted. Removing an image deletes its file after the save. |

### Hotel and flight lookups (ITN-25, ITN-26)

| ID | Rule (sheet) |
|---|---|
| ITN-25 | Pick a city group and view hotels available for its dates (check-in = the group's first day, check-out = the day after its last day) for a guest count and number of rooms, reusing hotel search (HTL-11). |
| ITN-26 | Search one-way or round-trip flights from a chosen origin airport to any airport in the city of the itinerary's first day. Outbound defaults to the start date, return to the last day's date; reuses FLT-11 and FLT-12. |

| # | Decision |
|---|---|
| D25 | Lookups are for the itinerary's owner (logged in; 404 / 403 as for other owner actions). |
| D26 | ITN-25 picks a city group by its number (`group`, 1 = the first of `cityGroups`), with `guests` (1–50) and `rooms` (1–20, not more than guests, default 1 as in HTL-11). The check-in must not be in the past (HTL-11; the hotel search itself doesn't check this). |
| D27 | ITN-25 calls `HotelsService.searchHotels` (Seif) with the city's **name** (hotels store the city as free text) and the dates, **without** guest counts, because that search filters by per-room occupancy. It reads every page (50 per page, up to 20 pages), so availability, active hotels and blocked rooms come from that search. Then it keeps hotels whose city equals the name (case-insensitive) and that have at least `rooms` free rooms whose combined maximum occupancy (`maxAdults + maxChildren`) covers `guests`: the N biggest rooms are checked, which is the best possible combination. Results are paginated by 10 here. Gap noted for Seif: the hotel search has no number-of-rooms parameter. |
| D28 | ITN-26 ("to **any** airport in the city of the first day"): `GET /flights/airports` lists the airports of day 1's city (`getAirportsInCity`). `GET /flights` searches **every** one of them with Yahia's `searchFlights` (all pages), merges the outbound and return lists, sorts them like FLT-15 (`sort` = price, duration or departure, default departure time) and paginates by 10. `to` is an optional filter to a single airport of that city (400 otherwise). Defaults: `tripType` one-way, `departureDate` = start date, `returnDate` = last day's date (round trips), 1 adult. Errors from the flight search itself (409s) are passed through. |

### PDF export (ITN-28, optional bonus)

| ID | Rule (sheet, Bonus section) |
|---|---|
| ITN-28 | The system shall allow a user to export or print an itinerary as PDF. (Depends on ITN-03.) |

This is an optional bonus row of the official sheet, listed in Person 8's brief as optional. It was built after every mandatory row above was done and tested.

| # | Decision |
|---|---|
| D29 | `GET /api/itineraries/:id/pdf` renders exactly the view of `GET /api/itineraries/:id` (same `findOne`), so it has the same visibility rules (D5): guests can export a public itinerary; a private one is 404 for everyone but its owner, admins too. "Print" is the same PDF, printed by the browser or viewer. |
| D30 | Content: title, dates, day count, visibility, countries, author and clone credit; the route (city groups with subtotals); each day with its date, city, notes, activities (time, name, cost, description) and budget entries; intercity transport; the budget by category and total. Totals also show the converted amount (ITN-18) with the rate date, in `?currency=`, else the preferred currency, else USD. If no rates are available the PDF is still produced, without conversion, and says why (the soft conversion of `GET :id`, not the 503 of `GET :id/budget`). |
| D31 | The download is named `itinerary-<id>.pdf`, never after the title, so user text never goes into a response header. It is rendered by a pure function (`itinerary-pdf.ts`, pdfkit, as in the FLT-23 e-ticket). The built-in Helvetica fonts only cover Western European text, so characters they cannot draw (e.g. Arabic) are shown as "?" instead of wrong letters. Known limit: embedding a Unicode font would lift it. |

## 3. Endpoints

| Method | Path | Req | Who |
|---|---|---|---|
| POST | `/api/itineraries` | ITN-01 | user |
| GET | `/api/itineraries/mine` | ITN-03 | logged in |
| GET | `/api/itineraries` | ITN-21 | anyone |
| GET | `/api/itineraries/:id` | ITN-03, ITN-21 | anyone who can see it |
| PATCH | `/api/itineraries/:id` | ITN-01 | owner |
| PATCH | `/api/itineraries/:id/visibility` | ITN-20 | owner |
| DELETE | `/api/itineraries/:id` (`{ confirm: true }`) | ITN-01 | owner |
| POST | `/api/itineraries/:id/clone` | ITN-21 | user who can see it |
| POST | `/api/itineraries/:id/days` | ITN-05 | owner |
| PATCH | `/api/itineraries/:id/days/:dayId` | ITN-05 | owner |
| DELETE | `/api/itineraries/:id/days/:dayId` (`{ confirm: true }`) | ITN-07 | owner |
| PATCH | `/api/itineraries/:id/days/:dayId/position` | ITN-08 | owner |
| POST, PATCH, DELETE | `/api/itineraries/:id/days/:dayId/activities[/:activityId]` | ITN-10 | owner |
| POST, DELETE | `/api/itineraries/:id/days/:dayId/activities/:activityId/images[/:imageId]` | ITN-12 | owner |
| POST, PATCH, DELETE | `/api/itineraries/:id/days/:dayId/budget-entries[/:entryId]` | ITN-14 | owner |
| POST, PATCH, DELETE | `/api/itineraries/:id/transport-entries[/:entryId]` | ITN-16 | owner |
| GET | `/api/itineraries/:id/hotels?group=&guests=&rooms=&page=` | ITN-25 | owner |
| GET | `/api/itineraries/:id/flights/airports` | ITN-26 | owner |
| GET | `/api/itineraries/:id/flights?from=&to=&tripType=&departureDate=&returnDate=&adults=&children=&infants=&cabinClass=&sort=&page=` | ITN-26 | owner |
| GET | `/api/itineraries/:id/pdf?currency=` | ITN-28 (bonus) | anyone who can see it |

## 4. Tests

- `src/itineraries/itinerary-view.spec.ts`: UTC dates across month, year and daylight-saving changes; numbering by position; city groups with subtotals; budget by category, by day and overall in several currencies; cents arithmetic; transport entries follow their day when moved; "Deleted user"; documents with only the contract fields.
- `src/itineraries/itinerary-access.spec.ts`: private, public, hidden, deactivated and suspended owners for owner, other user, admin and guest.
- `src/itineraries/itinerary-items.service.spec.ts` (in-memory MongoDB): add, move and delete days with transport entries; the 60-day limit; unknown cities; a parallel save is retried and both changes are kept; 409 after 12 attempts; hide and visibility are never overwritten; image files deleted when attaching fails or the day is deleted; clone credits, copies images and is independent; copied files are removed when the clone can't be saved.
- `test/itineraries.e2e-spec.ts` (HTTP, in-memory replica set):
  - **Create and days:** create rules (user only, validation); days and insertion; numbering and dates; city groups; my list order; start-date change.
  - **Budget:** activities, budget and transport with totals; clearing a cost; moving and deleting days (with confirmation).
  - **Parallel requests:** 10 day adds never lose or duplicate a day; 6 adds against 58 days give exactly 60; 7 image uploads keep exactly 5.
  - **Access:** private access (admins too); public read-only and Private at once; search by title, country, city and days, with paging; hidden; deactivated owner.
  - **Clone and delete:** clone independence and credit; owner delete closes reports and keeps the clone; admin delete through moderation, files removed.
- `src/itineraries/itinerary-search.service.spec.ts`: the "N rooms cover the guests" rule.
- `test/itinerary-search.e2e-spec.ts` (real hotel and flight searches):
  - **Hotels:** group dates; hotels with too few free rooms, a booked room, another city or an inactive hotel are excluded; one room for 4 guests; bad group, rooms > guests, past dates, other users and guests are rejected.
  - **Hotels:** `rooms` defaults to 1.
  - **Flights:** airports of day 1's city; one-way on the start date; round trip returning on the last day; a city with two airports gets both searched and merged (sorted by departure or price), `to` narrows to one and must be in that city; no days; other users.
- `src/itineraries/itinerary-pdf.spec.ts` (ITN-28): a valid PDF titled with the itinerary; days, activities, budget, transport, converted totals and rate date are drawn; still produced without rates; clone credit; Arabic text doesn't crash and shows as "?"; compressed by default; file name from the id.
- `test/itineraries.e2e-spec.ts` (ITN-28): the download is `application/pdf` named `itinerary-<id>.pdf`; a public itinerary exports for guests; a private one is 404 for guests, other users and admins; invalid id 400; unsupported currency 400.
- `test/itineraries.e2e-spec.ts` also sets the preferred currency through `PATCH /api/users/me` (ACC-09) and checks that an unsupported preference falls back to USD.
