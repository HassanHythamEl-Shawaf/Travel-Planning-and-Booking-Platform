import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Paginated, Pagination } from '../common/pagination';
import type { ContentType } from '../moderation/moderation.types';
import { User } from '../users/schemas/user.schema';
import {
  AdminReportItemDto,
  type ReportStatusFilter,
} from './dto/admin-report.dto';
import { ReportReason, ReportStatus } from './report.constants';
import { Report } from './schemas/report.schema';

export const DELETED_USER = 'Deleted user';

export interface AdminReportFilter {
  status?: ReportStatusFilter;
  targetType?: ContentType;
  reason?: ReportReason;
  targetId?: string;
  from?: Date;
  to?: Date;
}

const targetKey = (type: string, id: Types.ObjectId | string) =>
  `${type}:${id.toString()}`;

/** Admin report queue (GEN-09, GEN-10). */
@Injectable()
export class AdminReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async list(
    filter: AdminReportFilter,
    page: Pagination,
  ): Promise<Paginated<AdminReportItemDto>> {
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const status = filter.status ?? ReportStatus.OPEN;
    const query: Record<string, unknown> = {};
    if (status !== 'all') query.status = status;
    if (filter.targetType) query.targetType = filter.targetType;
    if (filter.reason) query.reason = filter.reason;
    if (filter.targetId) query.targetId = new Types.ObjectId(filter.targetId);
    if (filter.from || filter.to) {
      query.createdAt = {
        ...(filter.from && { $gte: filter.from }),
        ...(filter.to && { $lte: filter.to }),
      };
    }

    const [docs, total] = await Promise.all([
      this.reportModel
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean()
        .exec(),
      this.reportModel.countDocuments(query).exec(),
    ]);

    const [people, openCounts] = await Promise.all([
      this.findPeople(docs),
      this.countOpenReports(docs),
    ]);

    return {
      items: docs.map((doc) => {
        const reporterId = doc.reporterId.toString();
        const reporter = people.get(reporterId);
        const authorId = doc.snapshot?.authorId?.toString() ?? '';
        return {
          id: doc._id.toString(),
          targetType: doc.targetType,
          targetId: doc.targetId.toString(),
          reason: doc.reason,
          details: doc.details ?? null,
          status: doc.status,
          reporter: {
            id: reporterId,
            name: reporter?.name ?? DELETED_USER,
            email: reporter?.email ?? null,
          },
          snapshot: {
            title: doc.snapshot?.title ?? null,
            excerpt: doc.snapshot?.excerpt ?? '',
            authorId,
            authorName: people.get(authorId)?.name ?? DELETED_USER,
          },
          openReportsOnTarget:
            openCounts.get(targetKey(doc.targetType, doc.targetId)) ?? 0,
          createdAt: doc.createdAt,
          resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
          resolvedAt: doc.resolvedAt ?? null,
          resolutionNote: doc.resolutionNote ?? null,
        };
      }),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  /** Reporters and authors of the page, in one `$in` query. */
  private async findPeople(
    docs: { reporterId: Types.ObjectId; snapshot?: { authorId?: Types.ObjectId } }[],
  ): Promise<Map<string, { name: string; email: string }>> {
    const ids = [
      ...new Set(
        docs.flatMap((doc) => [
          doc.reporterId.toString(),
          ...(doc.snapshot?.authorId ? [doc.snapshot.authorId.toString()] : []),
        ]),
      ),
    ];
    if (ids.length === 0) return new Map();
    const users = await this.userModel
      .find(
        { _id: { $in: ids.map((id) => new Types.ObjectId(id)) } },
        { name: 1, email: 1 },
      )
      .lean()
      .exec();
    return new Map(
      users.map((u) => [u._id.toString(), { name: u.name, email: u.email }]),
    );
  }

  /** Open reports per target on the page, in one grouped count. */
  private async countOpenReports(
    docs: { targetType: ContentType; targetId: Types.ObjectId }[],
  ): Promise<Map<string, number>> {
    if (docs.length === 0) return new Map();
    const targets = [
      ...new Map(
        docs.map((d) => [
          targetKey(d.targetType, d.targetId),
          { targetType: d.targetType, targetId: d.targetId },
        ]),
      ).values(),
    ];
    const rows = await this.reportModel
      .aggregate<{
        _id: { targetType: string; targetId: Types.ObjectId };
        count: number;
      }>([
        { $match: { status: ReportStatus.OPEN, $or: targets } },
        {
          $group: {
            _id: { targetType: '$targetType', targetId: '$targetId' },
            count: { $sum: 1 },
          },
        },
      ])
      .exec();
    return new Map(
      rows.map((r) => [targetKey(r._id.targetType, r._id.targetId), r.count]),
    );
  }
}
