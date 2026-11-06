import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import {
  MAX_PAYLOAD_STRING_LENGTH,
  NOTIFICATION_PAYLOAD_KEYS,
  NotificationType,
  renderNotification,
  sanitizeNotificationPayload,
} from './notification.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

const chain = (result: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(result) }),
  exec: () => Promise.resolve(result),
});

describe('notification templates', () => {
  it('renders every type without "undefined" when the payload is empty', () => {
    for (const type of Object.values(NotificationType)) {
      const message = renderNotification(type, {});
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/undefined|null/);
    }
  });

  it('uses payload fields and appends a reason', () => {
    expect(
      renderNotification(NotificationType.BOOKING_CONFIRMED, {
        bookingReference: 'ABC123',
      }),
    ).toBe('Your booking ABC123 is confirmed.');
    expect(
      renderNotification(NotificationType.ACCOUNT_SUSPENDED, {
        reason: 'Spam',
      }),
    ).toBe('Your account has been suspended by an administrator. Reason: Spam');
    expect(
      renderNotification(NotificationType.PROVIDER_DEACTIVATED, {
        providerName: 'Nile Air',
      }),
    ).toContain('Nile Air has been deactivated');
    expect(
      renderNotification(NotificationType.REFUND_ISSUED, {
        bookingReference: 'X1',
        amount: 50,
        currency: 'EUR',
      }),
    ).toBe('A refund of 50 EUR for your booking X1 has been issued.');
  });

  it('names the booking by type, reference and provider (spec §4)', () => {
    expect(
      renderNotification(NotificationType.BOOKING_CONFIRMED, {
        bookingType: 'flight',
        bookingReference: 'ABC123',
        providerName: 'Nile Air',
      }),
    ).toBe('Your flight booking ABC123 with Nile Air is confirmed.');
    expect(
      renderNotification(NotificationType.PAYMENT_FAILED, {
        bookingType: 'hotel',
        providerName: 'Hilton Cairo',
      }),
    ).toBe(
      'Payment for your hotel booking at Hilton Cairo failed. The booking is not confirmed; you can retry until the hold expires.',
    );
    expect(
      renderNotification(NotificationType.BOOKING_EXPIRED, {
        providerName: 'Nile Air',
      }),
    ).toBe(
      'The hold on your booking (Nile Air) expired before payment was completed.',
    );
    expect(
      renderNotification(NotificationType.BOOKING_CANCELLED, {
        bookingType: 'HOTEL',
        bookingReference: 'H9',
        reason: 'Plans changed',
      }),
    ).toBe('Your hotel booking H9 has been cancelled. Reason: Plans changed');
  });

  it('adds the new departure time to a schedule change when given', () => {
    expect(
      renderNotification(NotificationType.FLIGHT_SCHEDULE_CHANGED, {
        flightNumber: 'MS777',
        newDepartureTime: '2026-12-01 14:30 (Africa/Cairo)',
      }),
    ).toBe(
      'The schedule of flight MS777 has changed. New departure: 2026-12-01 14:30 (Africa/Cairo). Please review your booking.',
    );
    expect(
      renderNotification(NotificationType.FLIGHT_SCHEDULE_CHANGED, {
        flightNumber: 'MS777',
      }),
    ).toBe(
      'The schedule of flight MS777 has changed. Please review your booking.',
    );
  });
  it('names moderated content by title, falling back to a short excerpt (GEN-10)', () => {
    expect(
      renderNotification(NotificationType.CONTENT_HIDDEN, {
        contentType: 'post',
        title: 'Five days in Aswan',
      }),
    ).toContain('Your post "Five days in Aswan" has been hidden');
    expect(
      renderNotification(NotificationType.CONTENT_DELETED, {
        contentType: 'comment',
        title: null,
        excerpt: 'x'.repeat(80),
      }),
    ).toBe(
      `Your comment "${'x'.repeat(50)}…" has been removed by a moderator.`,
    );
    expect(
      renderNotification(NotificationType.CONTENT_UNHIDDEN, {
        contentType: 'review',
        excerpt: 'Clean rooms',
      }),
    ).toBe('Your review "Clean rooms" is visible again.');
  });

  it('words REPORT_RESOLVED by outcome without naming anyone (D18)', () => {
    const taken = renderNotification(NotificationType.REPORT_RESOLVED, {
      outcome: 'action_taken',
      contentType: 'post',
    });
    const none = renderNotification(NotificationType.REPORT_RESOLVED, {
      outcome: 'no_violation',
      contentType: 'post',
    });
    expect(taken).toContain('took action');
    expect(none).toContain('found no violation');
    expect(`${taken} ${none}`).not.toMatch(/admin|reporter/i);
  });
});

describe('sanitizeNotificationPayload (spec §3)', () => {
  it('keeps allowed primitive fields and drops everything else', () => {
    const id = new Types.ObjectId();
    const when = new Date('2026-12-01T12:30:00Z');
    const { payload, dropped } = sanitizeNotificationPayload({
      bookingId: id,
      bookingReference: 'ABC123',
      amount: 120.5,
      title: null,
      reason: when,
      clientSecret: 'pi_123_secret_456',
      providerName: { name: 'nested object' },
      flightNumber: ['MS777'],
      currency: () => 'EUR',
      excerpt: 'x'.repeat(MAX_PAYLOAD_STRING_LENGTH + 20),
      refundId: Number.NaN,
    });

    expect(payload).toEqual({
      bookingId: id.toHexString(),
      bookingReference: 'ABC123',
      amount: 120.5,
      title: null,
      reason: '2026-12-01T12:30:00.000Z',
      excerpt: 'x'.repeat(MAX_PAYLOAD_STRING_LENGTH),
    });
    expect(dropped.sort()).toEqual(
      [
        'clientSecret',
        'currency',
        'flightNumber',
        'providerName',
        'refundId',
      ].sort(),
    );
  });

  it('returns an empty payload for non-objects', () => {
    for (const input of [undefined, null, 'text', 42, ['a']]) {
      expect(sanitizeNotificationPayload(input)).toEqual({
        payload: {},
        dropped: [],
      });
    }
  });

  it('allows every key the moderation and admin code already sends', () => {
    const keys: string[] = [...NOTIFICATION_PAYLOAD_KEYS];
    for (const key of [
      'reason',
      'providerType',
      'providerId',
      'providerName',
      'contentType',
      'contentId',
      'title',
      'excerpt',
      'outcome',
    ]) {
      expect(keys).toContain(key);
    }
  });
});

describe('NotificationsService', () => {
  let model: {
    insertMany: jest.Mock;
    findOneAndUpdate: jest.Mock;
    findOne: jest.Mock;
    updateMany: jest.Mock;
  };
  let service: NotificationsService;

  beforeEach(() => {
    model = {
      insertMany: jest.fn().mockResolvedValue([]),
      findOneAndUpdate: jest.fn().mockReturnValue(chain(null)),
      findOne: jest.fn().mockReturnValue(chain(null)),
      updateMany: jest.fn().mockReturnValue(chain({ modifiedCount: 2 })),
    };
    service = new NotificationsService(model as never);
  });

  it('sendMany inserts one rendered notification per distinct valid user', async () => {
    const a = new Types.ObjectId().toString();
    const b = new Types.ObjectId().toString();

    await service.sendMany(
      [a, b, a, 'bad-id'],
      NotificationType.FLIGHT_CANCELLED,
      {
        flightNumber: 'MS777',
      },
    );

    const [docs, options] = model.insertMany.mock.calls[0];
    expect(options).toEqual({ ordered: false });
    expect(docs).toHaveLength(2);
    expect(
      docs.map((d: { userId: Types.ObjectId }) => d.userId.toString()),
    ).toEqual([a, b]);
    expect(docs[0]).toMatchObject({
      type: NotificationType.FLIGHT_CANCELLED,
      message: 'Flight MS777 has been cancelled by the airline.',
      payload: { flightNumber: 'MS777' },
    });
  });

  it('stores and renders the cleaned payload, never the raw one', async () => {
    await service.send(
      new Types.ObjectId().toString(),
      NotificationType.PAYMENT_FAILED,
      {
        bookingType: 'hotel',
        providerName: 'Hilton Cairo',
        clientSecret: 'pi_123_secret_456',
      },
    );
    const [doc] = model.insertMany.mock.calls[0][0];
    expect(doc.payload).toEqual({
      bookingType: 'hotel',
      providerName: 'Hilton Cairo',
    });
    expect(doc.message).toContain('hotel booking at Hilton Cairo');
    expect(JSON.stringify(doc)).not.toContain('secret');
  });

  it('send delegates to a single insert', async () => {
    await service.send(
      new Types.ObjectId().toString(),
      NotificationType.PASSWORD_RESET_BY_ADMIN,
    );
    expect(model.insertMany.mock.calls[0][0]).toHaveLength(1);
  });

  it('does nothing for an empty recipient list', async () => {
    await service.sendMany([], NotificationType.BOOKING_CONFIRMED);
    expect(model.insertMany).not.toHaveBeenCalled();
  });

  it('never throws when the database write fails', async () => {
    model.insertMany.mockRejectedValue(new Error('connection lost'));
    await expect(
      service.send(
        new Types.ObjectId().toString(),
        NotificationType.BOOKING_CONFIRMED,
      ),
    ).resolves.toBeUndefined();
  });

  it('markRead is scoped to the owner and 404s for anyone else', async () => {
    const owner = new Types.ObjectId().toString();
    const id = new Types.ObjectId().toString();

    await expect(service.markRead(owner, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const [filter] = model.findOneAndUpdate.mock.calls[0];
    expect(filter.userId.toString()).toBe(owner);
    expect(filter._id.toString()).toBe(id);
    expect(model.findOne.mock.calls[0][0].userId.toString()).toBe(owner);
  });

  it('markRead is idempotent for an already-read notification', async () => {
    const readAt = new Date('2026-11-01');
    model.findOne.mockReturnValue(chain({ readAt }));
    const id = new Types.ObjectId().toString();

    await expect(
      service.markRead(new Types.ObjectId().toString(), id),
    ).resolves.toEqual({ id, readAt });
  });

  it('markAllRead returns the number updated', async () => {
    await expect(
      service.markAllRead(new Types.ObjectId().toString()),
    ).resolves.toEqual({ updated: 2 });
  });
});

describe('NotificationsController', () => {
  it("passes the caller's id, so another user's notification is a 404", async () => {
    const service = {
      markRead: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Notification not found')),
    };
    const controller = new NotificationsController(service as never);
    const caller: AuthenticatedUser = { sub: 'caller-id', role: 'user' };

    await expect(
      controller.markRead(caller, 'other-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(service.markRead).toHaveBeenCalledWith('caller-id', 'other-id');
  });
});
