import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import { Paginated, Pagination } from '../common/pagination';
import { User } from '../users/schemas/user.schema';
import { AuditAction, AuditTargetType } from './audit-log.constants';
import { AuditLog } from './schemas/audit-log.schema';

export interface AuditEntry {
  actorId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  details?: Record<string, unknown>;
}

export interface AuditLogFilter {
  action?: AuditAction;
  actorId?: string;
  targetType?: AuditTargetType;
  from?: Date;
  to?: Date;
}

export interface AuditLogView {
  id: string;
  actorId: string;
  actorName: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

/** Keys that must never be written to the log, even by mistake. */
const SENSITIVE_KEY = /password|token|secret|hash/i;

/**
 * Audit log of administrative actions (GEN-07).
 *
 * Unlike NotificationService, `record` THROWS on failure: an admin action
 * without its audit entry must fail. Pass the session when the action runs
 * in a transaction.
 *
 * @example
 * await this.auditLogs.record({
 *   actorId: admin.sub,
 *   action: AuditAction.CONTENT_HIDDEN,
 *   targetType: AuditTargetType.POST,
 *   targetId: postId,
 *   details: { reportId },
 * });
 */
@Injectable()
export class AuditLogsService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLog>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  async record(entry: AuditEntry, session?: ClientSession): Promise<void> {
    await this.auditLogModel.create(
      [
        {
          actorId: new Types.ObjectId(entry.actorId),
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          details: sanitizeDetails(entry.details ?? {}),
        },
      ],
      { session },
    );
  }

  async list(
    filter: AuditLogFilter,
    page: Pagination,
  ): Promise<Paginated<AuditLogView>> {
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const query: Record<string, unknown> = {};
    if (filter.action) query.action = filter.action;
    if (filter.targetType) query.targetType = filter.targetType;
    if (filter.actorId) query.actorId = new Types.ObjectId(filter.actorId);
    if (filter.from || filter.to) {
      query.createdAt = {
        ...(filter.from && { $gte: filter.from }),
        ...(filter.to && { $lte: filter.to }),
      };
    }

    const [docs, total] = await Promise.all([
      this.auditLogModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean()
        .exec(),
      this.auditLogModel.countDocuments(query).exec(),
    ]);

    const actorIds = [...new Set(docs.map((doc) => doc.actorId.toString()))];
    const actors = actorIds.length
      ? await this.userModel
          .find({ _id: { $in: actorIds } }, { name: 1 })
          .lean()
          .exec()
      : [];
    const names = new Map(actors.map((a) => [a._id.toString(), a.name]));

    return {
      items: docs.map((doc) => ({
        id: doc._id.toString(),
        actorId: doc.actorId.toString(),
        actorName: names.get(doc.actorId.toString()) ?? null,
        action: doc.action,
        targetType: doc.targetType,
        targetId: doc.targetId,
        details: doc.details ?? {},
        createdAt: doc.createdAt,
      })),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }
}

function sanitizeDetails(
  details: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => !SENSITIVE_KEY.test(key)),
  );
}
