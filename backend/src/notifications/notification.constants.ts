/** In-app notification types (GEN-01). Teammates import this enum. */
export enum NotificationType {
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  BOOKING_EXPIRED = 'BOOKING_EXPIRED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  REFUND_ISSUED = 'REFUND_ISSUED',
  REFUND_FAILED = 'REFUND_FAILED',
  FLIGHT_SCHEDULE_CHANGED = 'FLIGHT_SCHEDULE_CHANGED',
  FLIGHT_CANCELLED = 'FLIGHT_CANCELLED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  PASSWORD_RESET_BY_ADMIN = 'PASSWORD_RESET_BY_ADMIN',
  PROVIDER_DEACTIVATED = 'PROVIDER_DEACTIVATED',
  PROVIDER_REACTIVATED = 'PROVIDER_REACTIVATED',
  CONTENT_HIDDEN = 'CONTENT_HIDDEN',
  CONTENT_UNHIDDEN = 'CONTENT_UNHIDDEN',
  CONTENT_DELETED = 'CONTENT_DELETED',
  REPORT_RESOLVED = 'REPORT_RESOLVED',
}

type Payload = Record<string, unknown>;

/** Returns payload[key] as text, or the fallback when missing/blank. */
function field(payload: Payload, key: string, fallback: string): string {
  const value = payload[key];
  if (value === undefined || value === null) return fallback;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return text.trim() ? text : fallback;
}

/** Appends " Reason: …" when the payload has one. */
function withReason(message: string, payload: Payload): string {
  const reason = field(payload, 'reason', '');
  return reason ? `${message} Reason: ${reason}` : message;
}

/**
 * Payload keys a notification may carry (GEN-01 spec §3). Anything else is
 * dropped by `sanitizeNotificationPayload`, so secrets or whole documents
 * never reach the client.
 */
export const NOTIFICATION_PAYLOAD_KEYS = [
  'bookingId',
  'bookingType',
  'bookingReference',
  'providerType',
  'providerId',
  'providerName',
  'flightId',
  'flightNumber',
  'newDepartureTime',
  'hotelId',
  'paymentId',
  'refundId',
  'amount',
  'currency',
  'reason',
  'contentType',
  'contentId',
  'title',
  'excerpt',
  'outcome',
] as const;

const ALLOWED_KEYS: ReadonlySet<string> = new Set(NOTIFICATION_PAYLOAD_KEYS);

export const MAX_PAYLOAD_STRING_LENGTH = 500;

/**
 * Keeps only allowed keys with primitive values. Dates become ISO strings,
 * ObjectIds become hex strings, long strings are cut. Returns the cleaned
 * payload and the names of the keys that were dropped.
 */
export function sanitizeNotificationPayload(payload: unknown): {
  payload: Payload;
  dropped: string[];
} {
  const clean: Payload = {};
  const dropped: string[] = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { payload: clean, dropped };
  }
  for (const [key, value] of Object.entries(payload as Payload)) {
    const normalized = normalizeValue(value);
    if (!ALLOWED_KEYS.has(key) || normalized === undefined) {
      dropped.push(key);
      continue;
    }
    clean[key] = normalized;
  }
  return { payload: clean, dropped };
}

function normalizeValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (isObjectIdLike(value)) return value.toHexString();
  switch (typeof value) {
    case 'string':
      return value.length > MAX_PAYLOAD_STRING_LENGTH
        ? value.slice(0, MAX_PAYLOAD_STRING_LENGTH)
        : value;
    case 'number':
      return Number.isFinite(value) ? value : undefined;
    case 'boolean':
      return value;
    default:
      return undefined;
  }
}

function isObjectIdLike(value: unknown): value is { toHexString(): string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { _bsontype?: unknown })._bsontype === 'ObjectId' &&
    typeof (value as { toHexString?: unknown }).toHexString === 'function'
  );
}

const PROVIDER_PREPOSITION: Record<string, (name: string) => string> = {
  flight: (name) => ` with ${name}`,
  hotel: (name) => ` at ${name}`,
};

/**
 * `flight booking ABC123 with Nile Air`, `hotel booking at Hilton Cairo`,
 * or plain `booking` (GEN-01 spec §4). The reference only exists after
 * confirmation, so type and provider make earlier messages specific.
 */
function bookingLabel(p: Payload): string {
  const type = field(p, 'bookingType', '').toLowerCase();
  const kind = type === 'flight' || type === 'hotel' ? `${type} ` : '';
  const reference = field(p, 'bookingReference', '');
  const providerName = field(p, 'providerName', '');
  const provider = providerName
    ? (PROVIDER_PREPOSITION[type]?.(providerName) ?? ` (${providerName})`)
    : '';
  return `${kind}booking${reference ? ` ${reference}` : ''}${provider}`;
}

const TITLE_FALLBACK_LENGTH = 50;

/**
 * `post "My week in Aswan"`: the content type plus the snapshot title,
 * falling back to the excerpt's first 50 characters (GEN-10).
 */
function contentLabel(p: Payload): string {
  const type = field(p, 'contentType', 'content');
  let title = field(p, 'title', '');
  if (!title) {
    const excerpt = Array.from(field(p, 'excerpt', '').trim());
    title = excerpt.slice(0, TITLE_FALLBACK_LENGTH).join('');
    if (excerpt.length > TITLE_FALLBACK_LENGTH) title += '…';
  }
  return title ? `${type} "${title}"` : type;
}

/**
 * Message templates. Every field is optional: a missing one falls back to a
 * generic phrase, so a template never renders "undefined".
 */
export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  (payload: Payload) => string
> = {
  [NotificationType.BOOKING_CONFIRMED]: (p) =>
    `Your ${bookingLabel(p)} is confirmed.`,
  [NotificationType.BOOKING_CANCELLED]: (p) =>
    withReason(`Your ${bookingLabel(p)} has been cancelled.`, p),
  [NotificationType.BOOKING_EXPIRED]: (p) =>
    `The hold on your ${bookingLabel(p)} expired before payment was completed.`,
  [NotificationType.PAYMENT_FAILED]: (p) =>
    `Payment for your ${bookingLabel(p)} failed. The booking is not confirmed; you can retry until the hold expires.`,
  [NotificationType.REFUND_ISSUED]: (p) => {
    const amount = field(p, 'amount', '');
    const currency = field(p, 'currency', '');
    const money = amount ? ` of ${`${amount} ${currency}`.trim()}` : '';
    return `A refund${money} for your ${bookingLabel(p)} has been issued.`;
  },
  [NotificationType.REFUND_FAILED]: (p) =>
    `The refund for your ${bookingLabel(p)} could not be processed. Our team will follow up.`,
  [NotificationType.FLIGHT_SCHEDULE_CHANGED]: (p) => {
    const flight = field(p, 'flightNumber', 'on your booking');
    const time = field(p, 'newDepartureTime', '');
    const when = time ? ` New departure: ${time}.` : '';
    return `The schedule of flight ${flight} has changed.${when} Please review your booking.`;
  },
  [NotificationType.FLIGHT_CANCELLED]: (p) =>
    withReason(
      `Flight ${field(p, 'flightNumber', 'on your booking')} has been cancelled by the airline.`,
      p,
    ),
  [NotificationType.ACCOUNT_SUSPENDED]: (p) =>
    withReason('Your account has been suspended by an administrator.', p),
  [NotificationType.ACCOUNT_REACTIVATED]: (p) =>
    withReason('Your account has been reactivated.', p),
  [NotificationType.PASSWORD_RESET_BY_ADMIN]: () =>
    'An administrator reset your password. Set a new password at your next login.',
  [NotificationType.PROVIDER_DEACTIVATED]: (p) =>
    `${field(p, 'providerName', 'A provider')} has been deactivated by an administrator. Existing confirmed bookings remain valid.`,
  [NotificationType.PROVIDER_REACTIVATED]: (p) =>
    `${field(p, 'providerName', 'A provider')} has been reactivated.`,
  [NotificationType.CONTENT_HIDDEN]: (p) =>
    withReason(
      `Your ${contentLabel(p)} has been hidden by a moderator. Only you and administrators can see it.`,
      p,
    ),
  [NotificationType.CONTENT_UNHIDDEN]: (p) =>
    `Your ${contentLabel(p)} is visible again.`,
  [NotificationType.CONTENT_DELETED]: (p) =>
    withReason(`Your ${contentLabel(p)} has been removed by a moderator.`, p),
  // Never names the admin or other reporters (D18).
  [NotificationType.REPORT_RESOLVED]: (p) =>
    field(p, 'outcome', '') === 'action_taken'
      ? `We reviewed the ${field(p, 'contentType', 'content')} you reported and took action. Thank you for helping keep the community safe.`
      : `We reviewed the ${field(p, 'contentType', 'content')} you reported and found no violation of our guidelines. Thank you for your report.`,
};

export function renderNotification(
  type: NotificationType,
  payload: Payload = {},
): string {
  const template = NOTIFICATION_TEMPLATES[type];
  return template ? template(payload) : 'You have a new notification.';
}
