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
  CONTENT_DELETED = 'CONTENT_DELETED',
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

const ref = (p: Payload) => field(p, 'bookingReference', 'your booking');

/**
 * Message templates. Every field is optional: a missing one falls back to a
 * generic phrase, so a template never renders "undefined".
 */
export const NOTIFICATION_TEMPLATES: Record<
  NotificationType,
  (payload: Payload) => string
> = {
  [NotificationType.BOOKING_CONFIRMED]: (p) =>
    `Your booking ${ref(p)} is confirmed.`,
  [NotificationType.BOOKING_CANCELLED]: (p) =>
    withReason(`Your booking ${ref(p)} has been cancelled.`, p),
  [NotificationType.BOOKING_EXPIRED]: (p) =>
    `The hold on ${ref(p)} expired before payment was completed.`,
  [NotificationType.PAYMENT_FAILED]: (p) =>
    `Payment for ${ref(p)} failed. The booking is not confirmed.`,
  [NotificationType.REFUND_ISSUED]: (p) => {
    const amount = field(p, 'amount', '');
    const currency = field(p, 'currency', '');
    const money = amount ? ` of ${`${amount} ${currency}`.trim()}` : '';
    return `A refund${money} for ${ref(p)} has been issued.`;
  },
  [NotificationType.REFUND_FAILED]: (p) =>
    `The refund for ${ref(p)} could not be processed. Our team will follow up.`,
  [NotificationType.FLIGHT_SCHEDULE_CHANGED]: (p) =>
    `The schedule of flight ${field(p, 'flightNumber', 'on your booking')} has changed. Please review your booking.`,
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
      `Your ${field(p, 'contentType', 'content')} has been hidden by a moderator.`,
      p,
    ),
  [NotificationType.CONTENT_DELETED]: (p) =>
    withReason(
      `Your ${field(p, 'contentType', 'content')} has been removed by a moderator.`,
      p,
    ),
};

export function renderNotification(
  type: NotificationType,
  payload: Payload = {},
): string {
  const template = NOTIFICATION_TEMPLATES[type];
  return template ? template(payload) : 'You have a new notification.';
}
