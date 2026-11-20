# Spec: In-app notifications, hardening and teammate contract

**Requirements:** GEN-01 (plus the notification parts of ACC-15, FLT-05, FLT-06, PAY-01, PAY-03, HTL-18, GEN-10)
**Owner:** Wael (Person 2)
**Branch:** `feature/GEN-01-notification-hardening` (based on `feature/GEN-10-admin-moderation`)

The module itself already exists (ACC-13 spec §7.8 and §8): `NotificationsService.send` / `sendMany`,
per-type message templates, and the owner-only endpoints `GET /api/notifications`,
`GET /api/notifications/unread-count`, `PATCH /api/notifications/:id/read` and
`PATCH /api/notifications/read-all`. This spec closes the gaps that appear once Persons 3, 4, 6 and 7
start calling it.

## 1. Decisions

| # | Decision |
|---|---|
| N1 | **One sender per event.** Every event has exactly one module that notifies (table in §2), so a user never gets two messages for the same thing. |
| N2 | **No `PAYMENT_SUCCEEDED` type.** `BOOKING_CONFIRMED` is the success message. It is sent by the booking owner's `confirmBooking()` (Arafa / Yassin), not by the payment webhook. |
| N3 | **Refunds:** `REFUND_ISSUED` only once Stripe reports the refund succeeded; `REFUND_FAILED` when it fails. No "refund pending" notification. |
| N4 | **Booking wording:** templates accept optional `bookingType` (`flight` / `hotel`) and `providerName`, because the booking reference only exists after confirmation. Example: "Payment for your hotel booking at Hilton Cairo failed." |
| N5 | **Payload allow-list.** The service keeps only the keys in §3, and only primitive values (string, number, boolean, null; a `Date` becomes an ISO string; strings are cut to 500 characters). Anything else is dropped and logged as a warning, so a Stripe `client_secret` or a whole Mongoose document can never reach the client. |
| N6 | **Transactions:** no `session` parameter. Callers send **after** their transaction commits. A notification sent inside a transaction that later aborts would be a ghost message. |
| N7 | **Suspended accounts:** `ACCOUNT_SUSPENDED` is readable only after reactivation (the AuthGuard blocks suspended users). Accepted, because login already answers 403 "Your account is suspended". |
| N8 | **Temporary passwords:** a moderator with `mustChangePassword` cannot read notifications until they change it. Accepted. |
| N9 | **Deactivated accounts (ACC-12):** notifications are kept. Nobody can read them. |
| N10 | **Out of scope for Milestone 1:** deleting notifications, TTL/retention, reminders ("hold expires in 2 minutes", "trip tomorrow"), notifying hotel moderators about new reservations, email notifications (optional bonus). |
| N11 | **No test-only endpoint.** Graders see notifications through real flows (§5). |
| N12 | **Wael does not edit teammates' modules.** They get the contract message in §6. |

## 2. Who sends what

| Event | Type | Sender | Recipients | Payload |
|---|---|---|---|---|
| Payment verified, booking confirmed | `BOOKING_CONFIRMED` | Arafa (flight) / Yassin (hotel), inside `confirmBooking()` after commit | booking owner | `bookingId, bookingType, bookingReference, providerName` |
| Payment failed (booking stays Pending Payment) | `PAYMENT_FAILED` | Abozaid (webhook) | booking owner | `bookingId, bookingType, providerName, paymentId` |
| Hold expired | `BOOKING_EXPIRED` | Arafa / Yassin, inside the release method that Abozaid's ExpiryService calls | booking owner | `bookingId, bookingType, providerName` |
| User cancels a booking | `BOOKING_CANCELLED` | Arafa / Yassin | booking owner | `bookingId, bookingType, bookingReference, providerName, reason?` |
| Refund succeeded | `REFUND_ISSUED` | Abozaid | booking owner | `bookingId, bookingType, bookingReference, refundId, amount, currency` |
| Refund failed | `REFUND_FAILED` | Abozaid | booking owner | `bookingId, bookingType, bookingReference, refundId` |
| Flight schedule changed | `FLIGHT_SCHEDULE_CHANGED` | Yahia | users with Confirmed bookings on the flight (`sendMany`) | `flightId, flightNumber, newDepartureTime` |
| Flight cancelled by the airline | `FLIGHT_CANCELLED` | **Yahia only**. Arafa's cancel-all-for-flight method returns the affected user ids (Confirmed and Pending Payment) and sends nothing itself. | those users (`sendMany`) | `flightId, flightNumber, reason?` |
| Account suspended / reactivated, admin password reset | `ACCOUNT_*`, `PASSWORD_RESET_BY_ADMIN` | Wael (done) | the account | `reason?` |
| Provider deactivated / reactivated | `PROVIDER_*` | Wael (done) | the provider's moderators and users with upcoming Confirmed bookings | `providerType, providerId, providerName` |
| Content hidden / unhidden / deleted, report resolved | `CONTENT_*`, `REPORT_RESOLVED` | Wael (done) | author / reporters | `contentType, contentId, title, excerpt, outcome` |
| Booking becomes Completed (GEN-11) | none | – | – | – |

A refund after an airline cancellation is a separate event (money moved), so the user gets
`FLIGHT_CANCELLED` and then `REFUND_ISSUED`. That is intended.

`newDepartureTime` is a ready-to-show string in the departure airport's local time, for example
`"2026-12-01 14:30 (Africa/Cairo)"`. Yahia formats it, because the time-zone logic is his.

## 3. Allowed payload keys

`bookingId, bookingType, bookingReference, providerType, providerId, providerName, flightId,
flightNumber, newDepartureTime, hotelId, paymentId, refundId, amount, currency, reason,
contentType, contentId, title, excerpt, outcome`

Adding a key means editing `NOTIFICATION_PAYLOAD_KEYS` in `notification.constants.ts` (Wael's file).

## 4. Template changes

- Booking types (`BOOKING_*`, `PAYMENT_FAILED`, `REFUND_*`) use one label:
  `[flight |hotel ]booking[ <reference>][ with <airline> | at <hotel> | (<provider>)]`.
  With only a reference this is the old text ("Your booking ABC123 is confirmed.").
- `PAYMENT_FAILED` adds "You can retry until the hold expires." (PAY-01).
- `FLIGHT_SCHEDULE_CHANGED` adds "New departure: <newDepartureTime>." when given.
- Every template still renders without "undefined" when the payload is empty.

## 5. Demo in Swagger (graders)

1. Log in as the seeded admin and `PATCH /api/admin/accounts/:id/suspend` a test user, then `/reactivate` it.
2. Log in as that user. `GET /api/notifications/unread-count` → `{ "count": 2 }`.
3. `GET /api/notifications` → newest first: reactivated, then suspended.
4. `PATCH /api/notifications/:id/read` on one, then `PATCH /api/notifications/read-all` → `{ "updated": 1 }`.
5. Use another user's notification id on `/:id/read` → 404.

## 6. Message to teammates

> Notifications are ready (`NotificationsModule`, Wael). Import the module and inject `NotificationsService`.
>
> ```ts
> await this.notifications.send(userId, NotificationType.BOOKING_CONFIRMED,
>   { bookingId, bookingType: 'flight', bookingReference, providerName });
> await this.notifications.sendMany(userIds, NotificationType.FLIGHT_CANCELLED, { flightId, flightNumber });
> ```
>
> - Call it **after** your transaction commits. It never throws.
> - Only the keys in `NOTIFICATION_PAYLOAD_KEYS` are kept; tell me if you need another one.
> - Who sends what is in `docs/requirements/GEN-01-notifications-spec.md` §2. In short: Arafa/Yassin send
>   CONFIRMED, EXPIRED and user CANCELLED; Abozaid sends PAYMENT_FAILED and REFUND_*; Yahia sends
>   SCHEDULE_CHANGED and FLIGHT_CANCELLED (Arafa's cancel-all returns the user ids and sends nothing).

## 7. Tests

- Allow-list: unknown keys, nested objects, arrays and functions are dropped; dates become ISO strings;
  long strings are cut; known keys survive; the stored payload equals the cleaned one.
- Templates: booking label with and without type, reference and provider; schedule-change time;
  the retry hint; every type renders without "undefined" or "null".
- Existing service, controller and admin/reports tests still pass.
