<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Cookie authentication

Browser requests that change data must send an `Origin` or `Referer` matching
`FRONTEND_URL` (or the API's own origin). The backend rejects requests from
other origins. Authentication cookies are `httpOnly`, use `SameSite=Lax`, and
are marked `Secure` in production. Keep the frontend and API on the same site
in production, and set `FRONTEND_URL` to the frontend's origin.

## Shared backend utilities

List endpoints should use `getPagination(page)` from `src/common/pagination.ts`.
It validates a positive integer page and returns the fixed page size of 10,
plus the MongoDB `skip` value.

The global HTTP exception filter preserves Nest HTTP errors and logs unexpected
server errors without returning internal details to clients.

### Provider ownership integration

Provider-specific moderator routes should use `@ProviderOwnership('airline')`
or `@ProviderOwnership('hotel')` with `ProviderOwnershipGuard` after
`AuthGuard`. The guard allows admins and checks moderators through the
`ProviderAssignmentReader` contract in `src/auth/provider-assignment.reader.ts`.
The assignment module must register a provider using
`PROVIDER_ASSIGNMENT_READER` and be imported by `AuthModule`; requests are
denied with a service-unavailable response until that integration is
registered. A route using this guard without `@ProviderOwnership()` also fails
closed.

### Account deactivation integration

`DELETE /api/users/me` requires `{ "confirm": true }` and checks
`BookingEligibilityReader.hasUpcomingConfirmedBookings(userId)` before
deactivating the account and clearing cookies. The flight and hotel booking
owners must provide a combined reader using the token
`BOOKING_ELIGIBILITY_READER` in a module imported by `AuthModule`. The endpoint
fails closed with service unavailable until that integration is registered.
User content owners must also resolve deactivated-user public references as
`Deleted user`.

## Seeding the database (GEN-12, ACC-18)

The seed loads the official reference data (countries, cities, airports, attractions)
from `src/seed/data/*.csv`, derives supported currencies from Countries, and creates
the seeded admin account.

1. In `backend/.env` set `MONGODB_URI`, `SEED_ADMIN_NAME`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`
   (password: 8+ characters, at least one letter and one digit).
2. From the `backend/` folder run: `npm run seed`

Safe to run repeatedly: it inserts missing records and updates changed ones, never deletes,
and never changes an existing admin's password. If any CSV row is invalid it prints every
error and writes nothing.

Reference IDs are the official dataset IDs (e.g. airport `CAI`, city `cairo`, country `EG`,
attraction `att-1`, currency `EUR`) and are stored as the documents' `_id`. Store them as
strings when referencing them from other schemas.

## Admin & moderator setup (ACC-13 – ACC-17, ACC-07a, GEN-07, GEN-01)

Log in as the seeded admin (see above), then in Swagger (`/api/docs`):

1. Create the airline or hotel first (`POST /api/airlines`, `POST /api/hotels`, owned by Persons 3–6).
2. `POST /api/admin/moderators` with `name`, `email`, `temporaryPassword`, `providerType`
   (`airline` | `hotel`) and `providerId`. The account, its assignment and the audit entry
   are written in one transaction. A moderator manages exactly one provider; a provider
   may have several moderators. Assignments are permanent: to move someone, suspend the
   account and create a new moderator.
3. The moderator logs in with the temporary password, calls `PATCH /api/auth/change-password`,
   then logs in again. `GET /api/moderator/assignment` tells the dashboard which provider it manages.

Other admin endpoints: `GET /api/admin/accounts`, `PATCH /api/admin/accounts/:id/suspend|reactivate`,
`POST /api/admin/users/:id/reset-password`, `PATCH /api/admin/providers/:type/:id/deactivate|reactivate`,
`GET /api/admin/bookings` (read-only) and `GET /api/admin/audit-logs`. Admin accounts cannot be
suspended or have their password reset. Suspending ends the account's sessions immediately.

**For teammates**

- **Provider routes:** decorate with `@UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)` and
  `@ProviderOwnership('airline' | 'hotel', '<id param>')`. Nest builds guards inside *your*
  module, so that module must import `UsersModule`, `JwtModule.register({})` and
  `ModeratorAssignmentsModule`. Without the last one the guard answers 503.
- **Deactivated providers:** the admin sets `isActive: false` on your `airlines` / `hotels`
  document. Exclude those from search and reject new holds/bookings. Their moderators
  automatically get 403 on provider routes.
- **Collection and field names** this code reads are listed in
  `src/integrations/teammate-contracts.ts`. If yours differ, change that file only.
- **Notifications:** import `NotificationsModule` and call
  `notificationsService.send(userId, NotificationType.X, payload)` *after* your transaction
  commits. It never throws. See "Notifications (GEN-01)" below for who sends which type.
- **Audit:** import `AuditLogsModule` and call `auditLogsService.record({...}, session?)`. It throws,
  so an action without its audit entry fails.

Tests: `npm test` (unit) and `npm run test:e2e -- admin` (in-memory MongoDB replica set via
`mongodb-memory-server`; the first run downloads a `mongod` binary, and Atlas is never touched).

## Notifications (GEN-01)

Endpoints (any logged-in account, own notifications only): `GET /api/notifications?page&unreadOnly`,
`GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read` (404 for someone else's)
and `PATCH /api/notifications/read-all`.

**Demo in Swagger:** as the admin, suspend and then reactivate a test user. Log in as that user:
unread count is 2, the list shows both (newest first), mark one read, then read-all → `{ "updated": 1 }`.

**For teammates** (full contract: `docs/requirements/GEN-01-notifications-spec.md`):

| Event | Type | Sender |
|---|---|---|
| Booking confirmed after payment | `BOOKING_CONFIRMED` | Arafa / Yassin, in `confirmBooking()` |
| Hold expired | `BOOKING_EXPIRED` | Arafa / Yassin, in the release method the ExpiryService calls |
| User cancels | `BOOKING_CANCELLED` | Arafa / Yassin |
| Payment failed | `PAYMENT_FAILED` | Abozaid |
| Refund succeeded / failed | `REFUND_ISSUED` / `REFUND_FAILED` | Abozaid |
| Schedule change | `FLIGHT_SCHEDULE_CHANGED` | Yahia |
| Airline cancels a flight | `FLIGHT_CANCELLED` | Yahia only (Arafa's cancel-all returns the user ids and sends nothing) |

- Send **after** your transaction commits; `send` / `sendMany` never throw.
- Pass `bookingType` (`'flight'` / `'hotel'`) and `providerName` with booking events, so the message
  reads "your hotel booking at Hilton Cairo" before a reference exists.
- Only the keys in `NOTIFICATION_PAYLOAD_KEYS` (`notification.constants.ts`) with primitive values
  are stored; anything else is dropped with a warning in the server log. Ask Wael to add a key.

## Reports & moderation (GEN-09, GEN-10)

Any logged-in account can report a blog post, comment, hotel review or itinerary:

- `POST /api/reports` with `targetType` (`post` | `comment` | `review` | `itinerary`), `targetId`,
  `reason` (`spam` | `harassment` | `inappropriate` | `misinformation` | `other`) and optional
  `details` (required when the reason is `other`, max 500 characters).
  Only content the caller can currently see is reportable (otherwise 404); reporting your own
  content is 403; one open report per account per item (409 until it is resolved).
- `GET /api/reports/mine` lists the caller's reports and their status.

Admins (Swagger tag **Admin – Moderation**):

- `GET /api/admin/reports`: open reports by default (`status=all` for every status), with
  reporter, a snapshot of the content taken at report time, and the number of open reports
  on the same content.
- `PATCH /api/admin/reports/:id` with `action: 'dismiss' | 'hide'` and an optional internal `note`.
  Resolving one report resolves **every** open report on the same content with the same outcome.
- `PATCH /api/admin/content/:type/:id/hide|unhide` moderates without a report. Unhiding never
  reopens reports.
- `DELETE /api/admin/content/:type/:id?note=…` deletes the content (a post also loses its
  comments and likes) and resolves its open reports as `content_deleted`.

Every admin action runs in one transaction with its audit entry (`REPORT_DISMISSED`,
`CONTENT_HIDDEN`, `CONTENT_UNHIDDEN`, `CONTENT_DELETED`). After the commit, the author gets
`CONTENT_HIDDEN` / `CONTENT_UNHIDDEN` / `CONTENT_DELETED`, and each reporter gets one
`REPORT_RESOLVED` (`action_taken` or `no_violation`). Notifications never name the admin or
other reporters.

**For content owners (Blog, reviews, itineraries)**

- Add `isHidden: boolean` (default `false`) to your schema. Hidden content must be visible only
  to its author and admins (404 for everyone else) and excluded from search, lists, counts and
  (for reviews) the hotel average rating. The moderation code only sets the flag.
- Until you register a handler, moderation reads and writes your raw collection with the names in
  `src/integrations/teammate-contracts.ts` (`CONTENT_COLLECTIONS`). Admin delete of reviews and
  itineraries answers **501** until you register a handler with `delete`.
- Register in your module (which imports `ModerationModule`):
  `onModuleInit() { this.moderationRegistry.register('review', { find, setHidden, delete }) }`.
  The interface and a full example are in `src/moderation/moderation.registry.ts`. Use the
  session you are given for every write, and recompute derived data (ratings, images) there.

Tests: `npm run test:e2e -- reports` (in-memory replica set, never Atlas).

## Blog (BLG-01 – BLG-12)

Swagger tag **Blog**. Full rules: `docs/requirements/BLG-blog-spec.md`.

- **Posts** — `POST /api/posts` (`title` 3–150, `content` 1–20,000, `tags`, `status`
  `draft` | `published`, default draft), `PATCH` / `DELETE /api/posts/:id` (author only),
  `GET /api/posts/mine` (drafts included, `status` filter). Publishing sets `publishedAt` the
  first time only; a post can go back to draft. Deleting a post also deletes its comments and
  likes, and closes open reports on them as `content_deleted`.
- **Reading** — `GET /api/posts/:id`, `GET /api/posts?q=&tag=&authorId=`,
  `GET /api/tags/:tag/posts` and `GET /api/authors/:id` are public. `q` matches the title, tags
  or author name. Results are ordered by likes + comments, newest first on ties.
  A draft is visible only to its author; a hidden post to its author and admins; a post by a
  deactivated author to admins only. Everyone else gets 404.
- **Tags** — up to 5 per post, each 1–30 characters of `a-z`, `0-9` and `-`. Tags are trimmed,
  lowercased and deduplicated (`"Cairo "` and `"cairo"` become one tag).
- **Comments** — `GET|POST /api/posts/:id/comments`, `PATCH|DELETE /api/comments/:id`
  (comment author only). Comments are 1–500 characters, listed oldest first, and allowed only on
  published, visible posts. Comments by deactivated accounts show as "Deleted user".
- **Likes** — `POST|DELETE /api/posts/:id/like`, both idempotent, both return
  `{ liked, likeCount }`. `likeCount` and `commentCount` are stored on the post and change in the
  same transaction as the like or comment (hidden comments are not counted).
- **Images** — `POST /api/posts/:id/images` (multipart `file`) and
  `DELETE /api/posts/:id/images/:imageId`. They go through the shared upload module (JPG/PNG,
  5 MB, max 5 per post; the first image is the cover). Until that module is bound to
  `BLOG_IMAGE_STORE` in `BlogModule`, both answer **501**.
- **Author page** — `GET /api/authors/:id` returns name, join date, published posts (paginated)
  and up to 10 public itineraries (read from `itineraries` via
  `ITINERARY_FIELDS` in `teammate-contracts.ts`).

Public GETs use `OptionalAuthGuard` (`src/blog/optional-auth.guard.ts`). It applies the same
checks as `AuthGuard`, but a missing or invalid session makes the request a guest request,
never a 401. Only `user` accounts write posts, comments and likes. Admins moderate through
the GEN-10 endpoints: Blog registers real `post` and `comment` moderation handlers, so hiding a
comment updates `commentCount`, and deleting a post removes its comments, likes and image files.

Tests: `npm run test:e2e -- blog` (in-memory replica set, includes 20 parallel likes).

## Airlines (FLT-01)

Airline profiles are exposed through Swagger under the **Airlines** tag:

- `POST /api/airlines` — administrator-only creation with a unique name and
  airline code. New airlines are active by default.
- `GET /api/airlines/:id` — public profile lookup.
- `PATCH /api/airlines/:id` — only the assigned airline moderator may edit the
  profile name or code. This route uses `ProviderOwnershipGuard` and does not
  grant administrators moderator editing access.

The `isActive` flag is owned by the profile for the separate administrator
deactivate/reactivate endpoints. Existing confirmed bookings are unaffected by
that flag. Airline logos are intentionally not accepted as direct URLs; the
profile has a `logoUrl` field and the module exposes an
`AIRLINE_LOGO_STORE` boundary for Person 8's shared JPG/PNG upload integration.
Until that integration is merged, sending `logoUrl` returns `501`.

Targeted validation:

```bash
npm test -- --runInBand src/airlines/airlines.service.spec.ts
npm run build
```

`GET /api/airlines/airports` (FLT-02) exposes the seeded, read-only airport
list with IATA code, name, city, country and IANA time zone. Flight inputs must
use these seeded airport identifiers.

`POST /api/airlines/flights` (FLT-03) is restricted to airline moderators and
accepts local departure and arrival date-times. The service resolves each
airport's IANA zone, stores UTC instants plus both zones, rejects past or
non-positive schedules, and enforces unique flight number per airline and
departure date.

Cabin inventory endpoints (FLT-04) are `POST /api/flights/:id/cabins` and
`PATCH /api/flights/:id/cabins/:cabinId`. They support Economy, Premium
Economy, Business and First once each, with positive seats and price plus
free-baggage count and maximum bag weight.

`PUT /api/airlines/:id/baggage-policy` (FLT-08) is restricted to the assigned
airline moderator and stores the extra-bag price and per-passenger maximum.

`PUT /api/airlines/:id/cancellation-policy` (FLT-09) stores unique
days-before-departure thresholds and refund percentages. The exported
`calculateRefundPercentage` helper selects the highest applicable threshold for
refund services.

`GET /api/airlines/flights/:id/status` (FLT-30) derives `Scheduled`, `Departed`,
or persisted `Cancelled` status from the flight departure time. The
`AirlinesService.getFlightStatus` method is the scheduler-facing contract; no
cron job is added here.

`GET /api/airlines/flights/search` (FLT-11) searches active airlines for
scheduled flights between seeded airports on the departure airport's local
date. Results include cabin availability; insufficient-capacity flights are
excluded and an empty result returns a friendly message.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Observability

In production applications, observability is essential for understanding how your system behaves, detecting issues early, and maintaining reliable performance.

[NestJS Observe](https://observe.nestjs.com) automatically instruments your NestJS application, giving you deep visibility into your system with minimal setup:

- **Distributed tracing:** Follow requests across services and understand how they flow through your system.
- **Waterfall analysis:** Visualize request execution and identify slow operations, bottlenecks, and unexpected delays.
- **Performance analysis:** Analyze application performance in real time and quickly pinpoint areas that need optimization.
- **Metrics:** Track key application and infrastructure metrics to understand system health and performance trends.
- **Logging:** Centralize and correlate logs with traces and other telemetry to make debugging easier.
- **Error tracking:** Detect errors quickly and investigate their root causes with the surrounding context.
- **SLA monitoring:** Track service-level objectives and identify when your application is approaching or exceeding defined thresholds.
- **Alarms and alerts:** Set up alerts for critical errors, performance degradation, SLA violations, and other anomalies so your team can react quickly.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Auto-instrument your application with [NestJS Observer](https://observer.nestjs.com). Distributed tracing, metrics, and logging made easy. Error tracking and performance monitoring for your NestJS applications.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
