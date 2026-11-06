import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { NotificationType, renderNotification } from './notification.constants';
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
    ).toBe('A refund of 50 EUR for X1 has been issued.');
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
    ).toBe(`Your comment "${'x'.repeat(50)}…" has been removed by a moderator.`);
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
