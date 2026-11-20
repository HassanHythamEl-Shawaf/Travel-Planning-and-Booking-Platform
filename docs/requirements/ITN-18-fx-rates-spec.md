# Spec: Exchange rates and budget conversion

**Requirements:** ITN-18. Related: ACC-09 (preferred currency), ITN-14 (budget totals), PAY-04 (booking prices are not converted)
**Owner:** Hammad (Person 8)
**Authority:** the official requirements sheet wins over this spec.

## 1. Requirement (from the sheet)

| ID | Rule |
|---|---|
| ITN-18 | Convert all itinerary budget amounts to the user's preferred currency (from the supported currency list) using exchange rates fetched once per day from a configured public exchange-rate API and cached in the database, and show the rate date. If the API is unavailable, the last cached rates are used. Booking prices are not converted (PAY-04). |

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Provider: FXRatesAPI, `GET https://api.fxratesapi.com/latest` with the default base (USD). Its response is `{ success, timestamp, date, base, rates: { CODE: number } }` (from the provider's OpenAPI description). The key `FXRATES_API_KEY` comes from `.env` through `ConfigService` and is sent as `Authorization: Bearer <key>`: never in the URL, logs, errors or responses. Calls are server-side only, with an 8-second timeout. |
| D2 | Once per day: rates are stored as one `fx_rate_snapshots` document per UTC day (`day` unique, `base`, `rateDate` from the provider, `rates`, `fetchedAt`). The first request of the day fetches them; later requests read the stored snapshot. Parallel requests share one fetch in a process, and the unique `day` index keeps it to one snapshot across processes. No cron job (the team has one scheduler, Person 7's). |
| D3 | API down, timeout, HTTP error or unexpected body: the latest cached snapshot is used and `usingCachedRates: true` with its `rateDate` is returned. After a failure the API is not called again for 10 minutes. With no snapshot at all: **503** "Exchange rates are unavailable right now". The response body is checked; invalid entries are dropped, and the base currency's own rate is 1. |
| D4 | Display currency: `?currency=` if given, else the user's `preferredCurrency` (ACC-09), else **USD** (also for guests viewing public itineraries). A requested currency must be in the supported list seeded from Countries.csv (400 otherwise). An unsupported stored preference falls back to USD. |
| D5 | Maths: rates are against one base, so `converted = amount / rate[from] * rate[to]`. Single amounts are rounded to 2 decimals; a total in several currencies is converted per currency, summed, then rounded once. A currency the provider has no rate for gives **503** "No exchange rate is available for XYZ". |
| D6 | What is converted: every total (by category, by day, overall, city-group subtotals) gets `converted`; every budget entry and transport entry gets `convertedAmount`; activities get `convertedCost`. The original amounts and currencies stay as they are. `budget.conversion` = `{ currency, rateDate, usingCachedRates }`. |
| D7 | `GET /api/itineraries/:id` (and every write response) includes the conversion, but never fails because of it: with no rates, `budget.conversion` is `null` and `budget.conversionError` gives the reason. `GET /api/itineraries/:id/budget` is the budget alone, and answers 503 when it can't convert. |
| D8 | Tests never call the real API: the HTTP client is behind the `FX_RATES_CLIENT` token and is replaced by a fake. |

## 3. Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/api/itineraries/:id?currency=` | anyone who can see it (converted amounts inside `budget`) |
| GET | `/api/itineraries/:id/budget?currency=` | anyone who can see it |

## 4. Tests

- `src/fx-rates/fx-rates.client.spec.ts`:
  - **Parsing:** the provider's response is parsed; error bodies and unexpected shapes are rejected.
  - **Key handling:** the key goes only in the Bearer header, and with no key there's no header.
  - **Errors:** HTTP errors, timeouts, network errors and bad JSON become `FxApiError` without the key.
- `src/fx-rates/fx-rates.service.spec.ts` (in-memory MongoDB):
  - **Maths:** cross rates, sums rounded once, a clear 503 for a missing rate.
  - **Fetching:** once per day; one call for 8 parallel requests; one snapshot when another server saved first.
  - **Failures:** the cached fallback with `usingCachedRates`, the 10-minute wait, and 503 with nothing cached.
  - **Display currency:** requested, then preferred, then USD; 400 for an unsupported currency.
- `src/itineraries/itinerary-view.spec.ts`: every total and entry gets its converted amount; the originals are unchanged.
- `test/itineraries.e2e-spec.ts` (fake provider):
  - **Defaults:** USD by default and a single fetch.
  - **Currency choice:** `?currency=EGP`, the preferred currency (JOD), and 400 for `XYZ` and lowercase.
  - **Privacy:** a private itinerary's budget gives 404 to others.
  - **No rates:** the detail still loads with `conversion: null`, and `/budget` answers 503.
  - **Cache fallback:** an older snapshot is used with `usingCachedRates: true`.
