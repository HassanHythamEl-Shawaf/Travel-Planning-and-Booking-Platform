import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Paginated, Pagination } from '../common/pagination';
import { NotificationType, renderNotification } from './notification.constants';
import { Notification } from './schemas/notification.schema';

export interface NotificationView {
  id: string;
  type: NotificationType;
  message: string;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

/**
 * In-app notifications (GEN-01), shared by every module.
 *
 * `send` / `sendMany` NEVER throw: failures are logged, so a notification
 * problem can never roll back a booking, payment or admin action. Call them
 * AFTER your transaction commits, never inside it.
 *
 * @example
 * // in your module: imports: [NotificationsModule]
 * constructor(private readonly notifications: NotificationsService) {}
 *
 * await this.notifications.send(booking.userId.toString(),
 *   NotificationType.BOOKING_CONFIRMED,
 *   { bookingId: booking.id, bookingReference: booking.bookingReference });
 *
 * await this.notifications.sendMany(passengerUserIds,
 *   NotificationType.FLIGHT_SCHEDULE_CHANGED, { flightId, flightNumber });
 *
 * The message text is rendered from the type's template using the payload
 * (bookingReference, amount, currency, flightNumber, providerName,
 * contentType, reason). Missing fields fall back to generic wording.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
  ) {}

  async send(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    await this.sendMany([userId], type, payload);
  }

  async sendMany(
    userIds: string[],
    type: NotificationType,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      const recipients = [...new Set(userIds)].filter((id) =>
        Types.ObjectId.isValid(id),
      );
      if (recipients.length === 0) return;

      const message = renderNotification(type, payload);
      await this.notificationModel.insertMany(
        recipients.map((id) => ({
          userId: new Types.ObjectId(id),
          type,
          message,
          payload,
        })),
        { ordered: false },
      );
    } catch (error) {
      this.logger.error(
        `Failed to send ${type} notification to ${userIds.length} user(s): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(
    userId: string,
    unreadOnly: boolean,
    page: Pagination,
  ): Promise<Paginated<NotificationView>> {
    const query = {
      userId: new Types.ObjectId(userId),
      ...(unreadOnly && { readAt: null }),
    };
    const [docs, total] = await Promise.all([
      this.notificationModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(query).exec(),
    ]);
    return {
      items: docs.map((doc) => ({
        id: doc._id.toString(),
        type: doc.type,
        message: doc.message,
        payload: doc.payload ?? {},
        readAt: doc.readAt ?? null,
        createdAt: doc.createdAt,
      })),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notificationModel
      .countDocuments({ userId: new Types.ObjectId(userId), readAt: null })
      .exec();
    return { count };
  }

  /**
   * Idempotent. 404 when the notification is not the caller's, without
   * revealing whether it exists.
   */
  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<{ id: string; readAt: Date }> {
    const owned = {
      _id: new Types.ObjectId(notificationId),
      userId: new Types.ObjectId(userId),
    };
    const updated = await this.notificationModel
      .findOneAndUpdate(
        { ...owned, readAt: null },
        { $set: { readAt: new Date() } },
        { new: true, projection: { readAt: 1 } },
      )
      .lean()
      .exec();
    const doc =
      updated ??
      (await this.notificationModel
        .findOne(owned, { readAt: 1 })
        .lean()
        .exec());
    if (!doc || !doc.readAt) {
      throw new NotFoundException('Notification not found');
    }
    return { id: notificationId, readAt: doc.readAt };
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const result = await this.notificationModel
      .updateMany(
        { userId: new Types.ObjectId(userId), readAt: null },
        { $set: { readAt: new Date() } },
      )
      .exec();
    return { updated: result.modifiedCount };
  }
}
