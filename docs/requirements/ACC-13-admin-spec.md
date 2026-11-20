# Spec: Moderator Assignment, Admin, Audit Log, Notifications

**Requirements:** ACC-13, ACC-14, ACC-15, ACC-16, ACC-17, ACC-07a, GEN-07, GEN-01 (core)
**Owner:** Wael (Person 2)
**Authority:** the official requirements sheet. Relevant rows, summarised:

| ID | Rule |
|---|---|
| ACC-13 | Admin creates a hotel or airline moderator (name, email, role) linked to **exactly one** provider, with an **admin-set temporary password**; the moderator must change it at first login. Depends on FLT-01/HTL-01 (admin creates the provider first). |
| ACC-14 | Admin views a paginated list of all accounts, searches by name or email, filters by role and status. |
| ACC-15 | Admin suspends/reactivates moderator accounts, and **separately** deactivates/reactivates hotels or airlines. Deactivated providers are hidden from search and not bookable; existing Confirmed bookings stay valid; affected parties get in-app notifications. |
| ACC-16 | Admin suspends/reactivates registered users. Suspended users cannot log in; their bookings stay valid; their content stays visible unless hidden via GEN-10. |
| ACC-17 | Admin views a **read-only** list of all flight and hotel bookings, filterable by type, status and date range. |
| ACC-07a | Admin resets a user's or moderator's password to a temporary one; the account must set a compliant password at next login. |
| GEN-07 | Audit log of admin actions. |
| GEN-01 | In-app notifications: unread count, list, mark as read. Covers booking confirmation/cancellation/refund, schedule changes, account or provider suspension. |

---

## 1. Decisions (final, from the design review)

| # | Decision |
|---|---|
| D1 | Keep Hassan's interface in `auth/provider-assignment.reader.ts` exactly as it is: single `UserRole.MODERATOR`, and `providerType: 'airline' \| 'hotel'` lives on the assignment. Do **not** edit `UserRole`. |
| D2 | The assignment lives in a standalone `ModeratorAssignmentsModule` that both `AuthModule` and `AdminModule` import, which avoids a circular import. |
| D3 | `moderatorId` and `providerId` are stored as **ObjectId** (airlines and hotels are created through the API, so they get ObjectIds, unlike the CSV reference data). The reader returns them as **strings** because Hassan's guard compares strings. |
| D4 | Unique index on `moderatorId` only, so each moderator has exactly one provider. **One provider may have several moderators**: the sheet limits moderators to one provider, not providers to one moderator. |
| D5 | Assignments are **permanent**. There is no reassign endpoint. To move someone, suspend the account and create a new moderator. |
| D6 | The assignment also stores `assignedBy` (admin id) and timestamps. |
| D7 | Provider and booking collections belong to Persons 3–6 and don't exist yet. Do **not** create their schemas. Read and write them through two small adapters (`ProviderDirectory`, `BookingDirectory`) that use the raw collections and the names in §4. All teammate-facing names sit in **one file**, so a mismatch is a one-line fix. |
| D8 | Assigning a moderator to a **deactivated** provider → 409. |
| D9 | The temporary password is set by the admin and does **not** have to meet the password rules (string, 1–128 chars). It is never returned or logged. |
| D10 | Creating the user, its assignment and its audit entry happens in **one MongoDB transaction** (Atlas is a replica set). |
| D11 | Duplicate email → **409**. |
| D12 | Suspending clears `refreshTokenHash`. Hassan's `AuthGuard` rejects any request without it, so the session ends immediately. |
| D13 | Admin accounts can't be suspended or have their password reset by anyone, including themselves (403). |
| D14 | Suspending a moderator keeps the assignment, so reactivating restores access. The suspended account gets an in-app notification and sees it after reactivation. |
| D15 | Provider deactivation sets `isActive` through `ProviderDirectory`. It notifies the provider's moderators **and** every user with an upcoming Confirmed booking on that provider (deduplicated). |
| D16 | While a provider is deactivated, its moderators can't manage it: the reader returns `null`, so Hassan's guard answers 403. Admins are unaffected. |
| D17 | Moderator rows in the accounts list include their assignment. |
| D18 | Name/email search uses an **escaped**, case-insensitive regex. |
| D19 | Admin password reset sets `mustChangePassword = true`, clears `refreshTokenHash`, and resets the lockout counters. |
| D20 | Admin bookings is **one** paginated list over both booking collections (`$unionWith`). `type` is optional. The date range applies to the booking's `createdAt`. |
| D21 | Audit log and `NotificationService` are built **before** the admin endpoints (PR 2), so the endpoints use them from the start. |
| D22 | ACC-13's assignment plus the reader ship first, in their own small PR, because Hassan's guard and every moderator endpoint is waiting on them. |
| D23 | Moderators get `GET /api/moderator/assignment` so the Milestone 2 dashboard knows which provider it manages. |

## 2. Out of scope (do not build)

- `POST /api/airlines`, `POST /api/hotels`, and the Airline/Hotel/Booking schemas (Persons 3–6).
- Filtering `isActive` out of flight/hotel search and blocking new holds on deactivated providers (Persons 3–6 read the flag).
- Binding Hassan's `BOOKING_ELIGIBILITY_READER` (ACC-12, Person 1).
- Reports (GEN-09/GEN-10) and Blog. They come in later specs, but the audit enum already includes their actions (§9).
- Email notifications (optional bonus).

## 3. Before anything: finish GEN-12

The seed work is still uncommitted on `feature/GEN-12-reference-data-seed` (`src/seed/`, `src/reference-data/` untracked).

1. Stage **by explicit path only** (`backend/src/seed backend/src/reference-data backend/src/app.module.ts backend/src/common/pagination.ts backend/package.json backend/package-lock.json backend/.env.example backend/README.md AI_PROMPTS.txt`). Do **not** stage `docs/requirements/ACC-13-admin-spec.md`.
2. Commit using the GEN-12 spec's commit split, push, and give me the PR title and body (target `develop`).
3. `git checkout develop && git pull origin develop`, then branch PR 1 from there.

## 4. Teammate contracts — `src/integrations/teammate-contracts.ts`

This is the only file that knows other people's names. Export these constants:

```ts
export const PROVIDER_COLLECTIONS = { airline: 'airlines', hotel: 'hotels' } as const;
// Mongoose default names for models Airline / Hotel.
// Fields read: _id (ObjectId), name (string), isActive (boolean; missing = true).
// Field written: isActive.

export const BOOKING_COLLECTIONS = { flight: 'flightbookings', hotel: 'hotelbookings' } as const;
// Mongoose default names for models FlightBooking / HotelBooking.
// Fields read, both: _id, userId (ObjectId), status (string), createdAt (Date),
//   bookingReference (string | null), totalPrice (number), currency (string)
// flight only: airlineId (ObjectId), departureAt (Date, outbound segment, UTC)
// hotel only:  hotelId (ObjectId), checkInDate (Date)

export const BOOKING_STATUS = {
  PENDING_PAYMENT: 'Pending Payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
  COMPLETED: 'Completed',
} as const;
```

If a shared booking-status enum already exists on `develop`, import it instead of redefining `BOOKING_STATUS`, and tell me.

## 5. Module layout and wiring

```
src/integrations/              IntegrationsModule (exports both tokens)
  teammate-contracts.ts
  provider-directory.ts        PROVIDER_DIRECTORY token + interface + Mongo adapter
  booking-directory.ts         BOOKING_DIRECTORY token + interface + Mongo adapter
src/moderator-assignments/     ModeratorAssignmentsModule
  schemas/moderator-assignment.schema.ts
  moderator-assignments.service.ts
  moderator-assignment.reader.ts   implements Hassan's ProviderAssignmentReader
  moderator.controller.ts          GET /api/moderator/assignment
src/audit-logs/                AuditLogsModule (schema, service, controller)
src/notifications/             NotificationsModule (schema, service, controller)
src/admin/                     AdminModule (controller, service, dto/)
```

- `ModeratorAssignmentsModule` imports `IntegrationsModule` and **provides and exports** `{ provide: PROVIDER_ASSIGNMENT_READER, useClass: MongoModeratorAssignmentReader }`. It must not import `AuthModule` (that would recreate the loop). Its controller therefore lives in `AdminModule` or uses guards provided by `AuthModule` via `AdminModule`. **Put `ModeratorController` in `AdminModule`.**
- **The only edit to Hassan's files:** add `ModeratorAssignmentsModule` to `imports` in `auth/auth.module.ts`. Mention it in the PR body.
- `AdminModule` imports `AuthModule`, `UsersModule`, `ModeratorAssignmentsModule`, `IntegrationsModule`, `AuditLogsModule`, `NotificationsModule`.
- `NotificationsModule` and `AuditLogsModule` export their services, for teammates.
- All admin routes: `@UseGuards(AuthGuard, RolesGuard) @Roles(UserRole.ADMIN)`. Moderator route: `@Roles(UserRole.MODERATOR)`.
- Register the new modules in `app.module.ts`.

### Adapters

```ts
interface ProviderSummary { id: string; type: ProviderType; name: string; isActive: boolean }
interface ProviderDirectory {
  find(type: ProviderType, id: string): Promise<ProviderSummary | null>;
  /** Conditional update: matches only if isActive !== active. Returns the new summary, or null if not found / already in that state (caller re-reads to tell 404 from 409). */
  setActive(type: ProviderType, id: string, active: boolean): Promise<ProviderSummary | null>;
}
interface BookingDirectory {
  findUserIdsWithUpcomingConfirmedBookings(type: ProviderType, providerId: string): Promise<string[]>;
  listAll(filter: AdminBookingFilter, page: Pagination): Promise<Paginated<AdminBookingRow>>;
}
```

The Mongo adapters use `@InjectConnection()` and `connection.collection(name)`. A missing collection returns empty or null and never throws. "Upcoming" means `status = CONFIRMED` and `departureAt` / `checkInDate` > now.

## 6. Schemas

**ModeratorAssignment** (`timestamps: true`, collection `moderatorassignments`)
- `moderatorId`: ObjectId, ref `User`, required, **unique**
- `providerType`: `'airline' | 'hotel'`, required
- `providerId`: ObjectId, required
- `assignedBy`: ObjectId, ref `User`, required
- index `{ providerType: 1, providerId: 1 }`

**AuditLog** (`timestamps: { createdAt: true, updatedAt: false }`). Immutable: no update or delete code paths.
- `actorId`: ObjectId ref User, required, indexed
- `action`: enum `AuditAction` (§9), required, indexed
- `targetType`: enum `'user' | 'airline' | 'hotel' | 'post' | 'comment' | 'review' | 'itinerary' | 'report'`
- `targetId`: string, required
- `details`: Mixed, default `{}`. **Never contains passwords or tokens.**
- index `{ createdAt: -1 }`

**Notification** (`timestamps: true`)
- `userId`: ObjectId ref User, required
- `type`: enum `NotificationType` (§8), required
- `message`: string, required
- `payload`: Mixed, default `{}`
- `readAt`: Date | null, default null
- index `{ userId: 1, readAt: 1, createdAt: -1 }`

## 7. Endpoints

Every endpoint gets `@ApiTags`, `@ApiOperation` (with the requirement ID), a body DTO where relevant, and every response listed below as an `@Api…Response`. ID params are validated as ObjectIds, so a bad one returns 400 before any DB call. Lists use Hassan's `getPagination()` (page size 10) and return his `Paginated<T>`.

### 7.1 `POST /api/admin/moderators` — ACC-13
Body: `name` (trimmed, 2–100), `email` (IsEmail, lowercased), `temporaryPassword` (string, 1–128, no complexity rule), `providerType` (`airline|hotel`), `providerId` (MongoId).
1. Provider not found → **404** `Airline not found` / `Hotel not found`. Provider inactive → **409**.
2. Email taken → **409** `Email is already registered`.
3. In `connection.transaction()`: create the User (`role: moderator`, `status: active`, `mustChangePassword: true`, bcrypt cost 12, `termsAcceptedAt` and `privacyPolicyAcceptedAt` = now, the same as the admin seed). Then create the assignment. Then the audit entry `MODERATOR_CREATED` `{ email, providerType, providerId }`.
4. A duplicate-key (E11000) error caused by a race → **409**.
5. **201** `{ id, name, email, role, status, mustChangePassword, assignment: { providerType, providerId, assignedBy, createdAt } }`.
Responses: 201, 400, 401, 403, 404, 409.

### 7.2 `GET /api/admin/accounts` — ACC-14
Query: `page`, `search` (≤100, escaped, matches name OR email, case-insensitive), `role` (UserRole), `status` (AccountStatus). Sorted `createdAt` desc.
Item: `{ id, name, email, role, status, mustChangePassword, lockUntil, createdAt, assignment: {providerType, providerId} | null }`. Assignments are fetched with **one** `$in` query per page. Never select `passwordHash` / `refreshTokenHash`.

### 7.3 `PATCH /api/admin/accounts/:id/suspend` and `/reactivate` — ACC-15 (moderators), ACC-16 (users)
Body (optional): `reason` (≤500).
- 404 if not found. **403** if the target is an admin (this covers self).
- Suspend only from `active`. `suspended` → 409 `Account is already suspended`; `deactivated` → 409.
- Reactivate only from `suspended`. Anything else → 409.
- Use a conditional `updateOne({ _id, status: <expected> })` so two admins clicking at once can't both succeed.
- Suspend sets `status: suspended`, `refreshTokenHash: null`. Reactivate sets `status: active`, `failedLoginAttempts: 0`, `lockUntil: null`.
- Bookings and content are not touched.
- Notify `ACCOUNT_SUSPENDED` / `ACCOUNT_REACTIVATED` (include `reason` if given). Audit `ACCOUNT_SUSPENDED` / `ACCOUNT_REACTIVATED` `{ role, reason }`.
- **200** `{ id, status }`.

### 7.4 `POST /api/admin/users/:id/reset-password` — ACC-07a
Body: `temporaryPassword` (as in 7.1).
- 404 / 403 for an admin target / 409 for `deactivated`. Allowed on `active` and `suspended` (the status doesn't change).
- Sets the hash, `mustChangePassword: true`, `refreshTokenHash: null`, `failedLoginAttempts: 0`, `lockUntil: null`.
- Notify `PASSWORD_RESET_BY_ADMIN`. Audit `PASSWORD_RESET_BY_ADMIN` (no password in details).
- **200** `{ id, mustChangePassword: true }`.

### 7.5 `PATCH /api/admin/providers/:type/:id/deactivate` and `/reactivate` — ACC-15
- `type` validated with `ParseEnumPipe` (`airline|hotel`) → 400. Bad id → 400.
- Not found → 404. Already in that state → 409.
- `providerDirectory.setActive(...)`.
- Recipients = the provider's moderator ids + `bookingDirectory.findUserIdsWithUpcomingConfirmedBookings(...)`, deduplicated. `notifications.sendMany(recipients, PROVIDER_DEACTIVATED | PROVIDER_REACTIVATED, { providerType, providerId, providerName })`.
- Audit `PROVIDER_DEACTIVATED` / `PROVIDER_REACTIVATED` `{ providerName, notifiedUsers }`.
- **200** `{ providerType, providerId, isActive, notifiedUsers }`.
- Existing bookings are not touched.

### 7.6 `GET /api/admin/bookings` — ACC-17 (read-only)
Query: `page`, `type` (`flight|hotel`, optional), `status` (one of `BOOKING_STATUS`), `from`, `to` (ISO 8601 dates on `createdAt`; `from > to` → 400).
One aggregation: the flight collection `$unionWith` the hotel collection (or just one when `type` is set), a normalising `$project`, `$lookup` on users for `userName` / `userEmail`, sort `createdAt` desc then `_id` desc, and `$facet` for the items and the total.
Item: `{ id, type, bookingReference, status, userId, userName, userEmail, providerId, totalPrice, currency, createdAt }`. Missing collections → an empty page.

### 7.7 `GET /api/admin/audit-logs` — GEN-07
Query: `page`, `action`, `actorId`, `targetType`, `from`, `to`. Newest first. Item: `{ id, actorId, actorName, action, targetType, targetId, details, createdAt }`.

### 7.8 Notifications — GEN-01 (any logged-in user, owner-only)
- `GET /api/notifications?page&unreadOnly=true|false`, newest first.
- `GET /api/notifications/unread-count` → `{ count }`
- `PATCH /api/notifications/:id/read` → 404 if it isn't the caller's (don't reveal that it exists). Idempotent.
- `PATCH /api/notifications/read-all` → `{ updated }`

### 7.9 `GET /api/moderator/assignment` — supports ACC-13 (moderator role)
→ `{ providerType, providerId, providerName, isActive }`. 404 if none.

## 8. NotificationService (shared, used by Persons 3, 4, 6, 7)

```ts
send(userId: string, type: NotificationType, payload?: Record<string, unknown>): Promise<void>
sendMany(userIds: string[], type: NotificationType, payload?: Record<string, unknown>): Promise<void> // insertMany
```
- The message text is built from a per-type template map using the payload (with a sensible fallback if a field is missing).
- **Never throws to the caller.** It logs errors with Nest's `Logger`, so a notification failure can't roll back a booking or payment. Admin code calls it **after** the transaction commits.
- `NotificationType` enum (exported, so teammates use it):
  `BOOKING_CONFIRMED, BOOKING_CANCELLED, BOOKING_EXPIRED, PAYMENT_FAILED, REFUND_ISSUED, REFUND_FAILED, FLIGHT_SCHEDULE_CHANGED, FLIGHT_CANCELLED, ACCOUNT_SUSPENDED, ACCOUNT_REACTIVATED, PASSWORD_RESET_BY_ADMIN, PROVIDER_DEACTIVATED, PROVIDER_REACTIVATED, CONTENT_HIDDEN, CONTENT_DELETED`
- Add a short JSDoc usage example at the top of the service for teammates.

## 9. AuditLogService

`record(entry: { actorId; action; targetType; targetId; details? }, session?: ClientSession)`. Unlike notifications, it **does** throw, because an admin action without its audit entry must fail.
`AuditAction` enum: `MODERATOR_CREATED, ACCOUNT_SUSPENDED, ACCOUNT_REACTIVATED, PASSWORD_RESET_BY_ADMIN, PROVIDER_DEACTIVATED, PROVIDER_REACTIVATED, REPORT_DISMISSED, CONTENT_HIDDEN, CONTENT_UNHIDDEN, CONTENT_DELETED`.
For the non-transactional actions (7.3–7.5), write the audit entry right after the state change. If the audit write fails, log it at error level and return 500. (Simple, and acceptable for this project; mention it in the PR.)

## 10. The reader (`MongoModeratorAssignmentReader`)

`findByModeratorId(moderatorId)`:
1. Not a valid ObjectId → `null`.
2. Find the assignment (lean). None → `null`.
3. `providerDirectory.find(type, id)`. Missing or `isActive === false` → `null` (D16).
4. Return `{ moderatorId, providerType, providerId }` as **strings**.

## 11. Tests (must all pass: `npm test`, `npm run lint`, `npm run build`)

Unit tests with mocked models and adapters:
- **Reader:** invalid id, no assignment, provider missing, provider inactive, happy path (string ids).
- **Hassan's guard plus the real reader** wired in a `Test.createTestingModule`: assigned moderator allowed, wrong provider 403, other type 403, deactivated provider 403, admin allowed.
- **AdminService:** every rule in §7.1–7.5, including admin-target 403, self 403, each 409, the transaction aborting when the assignment insert fails (no orphan user), the E11000 → 409 mapping, suspend clearing `refreshTokenHash`, recipients deduplicated, and passwords never appearing in audit details or responses.
- **Search escaping:** `a.b*` matches literally.
- **NotificationService:** templates, `sendMany`, never throwing; controller ownership 404.
- **AuditLogService:** filters, ordering.
- **BookingDirectory:** `from > to` → 400; `type` filter picks one collection.

E2E (`test/admin.e2e-spec.ts`) with **`mongodb-memory-server` `MongoMemoryReplSet`** (allowed as a new devDependency). It never touches Atlas. Cover: create moderator → login → forced password change → access own provider route (a test controller decorated with `@ProviderOwnership('airline')`) → admin deactivates the airline → same request 403 → reactivate → 200; and two parallel suspend requests → exactly one 200, one 409.

## 12. Branches, commits, PRs

| PR | Branch (from latest `develop`) | Content |
|---|---|---|
| 1 | `feature/ACC-13-moderator-assignment` | integrations, moderator-assignments module + reader + the `auth.module.ts` import, the spec file in `docs/requirements/`, reader + guard tests |
| 2 | `feature/GEN-07-GEN-01-audit-and-notifications` | audit-logs and notifications modules + endpoints + tests |
| 3 | `feature/ACC-13-ACC-17-admin-endpoints` | admin module (§7.1–7.7, 7.9), e2e test, README section "Admin & moderator setup" |

If the previous PR isn't merged yet, branch from it instead and write "Depends on #N" in the PR body. Use Conventional Commits with requirement IDs, e.g. `feat(ACC-13): add moderator assignment schema and reader`. PR titles include the IDs. Give me each PR's title and body. Don't open PRs or push to `develop`/`main` yourself.

## 13. AI_PROMPTS.txt

One entry per PR in the required format, `Student: Wael (Person 2)`, `Tool: <the AI tool used>`, the related requirement IDs, the prompt, and how the output was used. No secrets.

## 14. Definition of Done

1. §3 done (GEN-12 committed, PR text given).
2. PR 1 implemented; tests, lint and build green; committed; PR text given.
3. PR 2 likewise.
4. PR 3 implemented; unit and e2e tests green; committed.
5. **STOP. Wait for me before touching Atlas.**
6. After I confirm: run the app against Atlas. Insert **one** fixture into `airlines` (`{ name: 'ZZ Test Airline (ACC-13 fixture)', isActive: true }`). Using Swagger flows (or curl with cookies), log in as the seeded admin and exercise 7.1–7.7 and 7.9 plus the notification endpoints. Paste a short pass/fail table.
7. Delete the fixture airline and the test moderator account plus its assignment and notifications. Leave the audit-log entries, because the log is append-only.
8. Final summary: files changed, anything you had to assume, and the team message from §15 updated if any name changed.

## 15. Ask me before

- changing anything in Hassan's files other than the one import in `auth.module.ts`
- creating any schema for airlines, hotels or bookings
- adding any dependency other than `mongodb-memory-server`
- any write to Atlas (step 6 onwards)
- deviating from a decision in §1
