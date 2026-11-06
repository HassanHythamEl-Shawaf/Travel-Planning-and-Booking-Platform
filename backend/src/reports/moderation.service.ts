import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import {
  AuditAction,
  AuditTargetType,
} from '../audit-logs/audit-log.constants';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ModerationRegistry } from '../moderation/moderation.registry';
import type {
  ContentType,
  ModeratableContent,
} from '../moderation/moderation.types';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ContentDeletedResponseDto,
  ContentVisibilityResponseDto,
  type ReportAction,
  ResolveReportResponseDto,
} from './dto/admin-report.dto';
import { ReportStatus } from './report.constants';
import { Report } from './schemas/report.schema';

const AUDIT_TARGET: Record<ContentType, AuditTargetType> = {
  post: AuditTargetType.POST,
  comment: AuditTargetType.COMMENT,
  review: AuditTargetType.REVIEW,
  itinerary: AuditTargetType.ITINERARY,
};

type ReportOutcome = 'action_taken' | 'no_violation';

interface AuditSnapshot {
  title: string | null;
  excerpt: string;
  authorId: string;
}

interface ResolvedReports {
  reportIds: string[];
  reporterIds: string[];
}

interface Resolution {
  status: ReportStatus;
  resolvedBy: Types.ObjectId;
  resolvedAt: Date;
  resolutionNote: string | null;
}

const NO_REPORTS: ResolvedReports = { reportIds: [], reporterIds: [] };

function snapshotOf(content: ModeratableContent): AuditSnapshot {
  return {
    title: content.snapshot.title ?? null,
    excerpt: content.snapshot.excerpt,
    authorId: content.authorId,
  };
}

/**
 * Admin moderation (GEN-10). Each action runs in one transaction: content
 * change + report updates + audit entry (D12). Notifications go out after
 * the commit and never fail the request.
 */
@Injectable()
export class ModerationService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    private readonly registry: ModerationRegistry,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------- PATCH /admin/reports/:id

  async resolveReport(
    adminId: string,
    reportId: string,
    action: ReportAction,
    note?: string,
  ): Promise<ResolveReportResponseDto> {
    const report = await this.reportModel.findById(reportId).lean().exec();
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.OPEN) {
      throw new ConflictException('Report is already resolved');
    }

    const type = report.targetType;
    const targetId = report.targetId.toString();
    const hide = action === 'hide';
    const resolution = this.resolution(
      adminId,
      hide ? ReportStatus.CONTENT_HIDDEN : ReportStatus.DISMISSED,
      note,
    );
    const handler = this.registry.get(type);

    const outcome = await this.connection.transaction(async (session) => {
      // Content deleted by its owner after the report: hide is impossible (D23).
      const content = hide ? await handler.find(targetId, session) : null;
      if (hide && !content) throw new NotFoundException('Content not found');

      // Claim this report; of two concurrent admins exactly one wins (D13).
      const claimed = await this.reportModel
        .updateOne(
          { _id: report._id, status: ReportStatus.OPEN },
          { $set: resolution },
          { session },
        )
        .exec();
      if (claimed.matchedCount === 0) {
        throw new ConflictException('Report is already resolved');
      }

      let alreadyHidden = false;
      if (content) {
        alreadyHidden =
          content.isHidden ||
          !(await handler.setHidden(targetId, true, session));
      }

      const others = await this.resolveOpenReports(
        type,
        targetId,
        resolution,
        session,
      );
      const resolved: ResolvedReports = {
        reportIds: [reportId, ...others.reportIds],
        reporterIds: [report.reporterId.toString(), ...others.reporterIds],
      };
      const snapshot: AuditSnapshot = content
        ? snapshotOf(content)
        : {
            title: report.snapshot?.title ?? null,
            excerpt: report.snapshot?.excerpt ?? '',
            authorId: report.snapshot?.authorId?.toString() ?? '',
          };

      await this.auditLogs.record(
        {
          actorId: adminId,
          action: hide ? AuditAction.CONTENT_HIDDEN : AuditAction.REPORT_DISMISSED,
          targetType: AUDIT_TARGET[type],
          targetId,
          details: {
            reportIds: resolved.reportIds,
            snapshot,
            note: resolution.resolutionNote,
            ...(alreadyHidden && { alreadyHidden: true }),
          },
        },
        session,
      );
      return { resolved, snapshot, alreadyHidden };
    });

    // After commit (D12). No author notification on dismiss (D18).
    if (hide && !outcome.alreadyHidden) {
      await this.notifyAuthor(
        NotificationType.CONTENT_HIDDEN,
        type,
        targetId,
        outcome.snapshot,
      );
    }
    await this.notifyReporters(
      outcome.resolved.reporterIds,
      outcome.snapshot.authorId,
      hide ? 'action_taken' : 'no_violation',
      type,
      targetId,
    );

    return {
      id: reportId,
      status: resolution.status,
      resolvedReports: outcome.resolved.reportIds.length,
    };
  }

  // ------------------------------ PATCH /admin/content/:type/:id/(un)hide

  async setVisibility(
    adminId: string,
    type: ContentType,
    targetId: string,
    hidden: boolean,
    note?: string,
  ): Promise<ContentVisibilityResponseDto> {
    const handler = this.registry.get(type);
    const resolution = this.resolution(
      adminId,
      ReportStatus.CONTENT_HIDDEN,
      note,
    );
    const stateConflict = hidden
      ? 'Content is already hidden'
      : 'Content is not hidden';

    const outcome = await this.connection.transaction(async (session) => {
      const content = await handler.find(targetId, session);
      if (!content) throw new NotFoundException('Content not found');
      if (content.isHidden === hidden) {
        throw new ConflictException(stateConflict);
      }
      if (!(await handler.setHidden(targetId, hidden, session))) {
        throw new ConflictException(stateConflict);
      }

      // Hiding resolves open reports; unhiding never reopens them (D10).
      const resolved = hidden
        ? await this.resolveOpenReports(type, targetId, resolution, session)
        : NO_REPORTS;
      const snapshot = snapshotOf(content);

      await this.auditLogs.record(
        {
          actorId: adminId,
          action: hidden
            ? AuditAction.CONTENT_HIDDEN
            : AuditAction.CONTENT_UNHIDDEN,
          targetType: AUDIT_TARGET[type],
          targetId,
          details: {
            reportIds: resolved.reportIds,
            snapshot,
            note: resolution.resolutionNote,
          },
        },
        session,
      );
      return { resolved, snapshot };
    });

    await this.notifyAuthor(
      hidden ? NotificationType.CONTENT_HIDDEN : NotificationType.CONTENT_UNHIDDEN,
      type,
      targetId,
      outcome.snapshot,
    );
    if (hidden) {
      await this.notifyReporters(
        outcome.resolved.reporterIds,
        outcome.snapshot.authorId,
        'action_taken',
        type,
        targetId,
      );
    }

    return {
      targetType: type,
      targetId,
      isHidden: hidden,
      resolvedReports: outcome.resolved.reportIds.length,
    };
  }

  // ----------------------------------- DELETE /admin/content/:type/:id

  async deleteContent(
    adminId: string,
    type: ContentType,
    targetId: string,
    note?: string,
  ): Promise<ContentDeletedResponseDto> {
    const handler = this.registry.get(type);
    if (!handler.delete) {
      throw new NotImplementedException(
        'Deleting this content type is not available yet',
      );
    }
    const remove = handler.delete.bind(handler);
    const resolution = this.resolution(
      adminId,
      ReportStatus.CONTENT_DELETED,
      note,
    );

    const outcome = await this.connection.transaction(async (session) => {
      const content = await handler.find(targetId, session);
      if (!content || !(await remove(targetId, session))) {
        throw new NotFoundException('Content not found');
      }
      const resolved = await this.resolveOpenReports(
        type,
        targetId,
        resolution,
        session,
      );
      const snapshot = snapshotOf(content);

      await this.auditLogs.record(
        {
          actorId: adminId,
          action: AuditAction.CONTENT_DELETED,
          targetType: AUDIT_TARGET[type],
          targetId,
          details: {
            reportIds: resolved.reportIds,
            snapshot,
            note: resolution.resolutionNote,
          },
        },
        session,
      );
      return { resolved, snapshot };
    });

    await this.notifyAuthor(
      NotificationType.CONTENT_DELETED,
      type,
      targetId,
      outcome.snapshot,
    );
    await this.notifyReporters(
      outcome.resolved.reporterIds,
      outcome.snapshot.authorId,
      'action_taken',
      type,
      targetId,
    );

    return {
      targetType: type,
      targetId,
      deleted: true,
      resolvedReports: outcome.resolved.reportIds.length,
    };
  }

  // --------------------------------------------------------------- helpers

  private resolution(
    adminId: string,
    status: ReportStatus,
    note?: string,
  ): Resolution {
    return {
      status,
      resolvedBy: new Types.ObjectId(adminId),
      resolvedAt: new Date(),
      resolutionNote: note?.trim() || null,
    };
  }

  /** Resolves every open report on the target with the same outcome (D8). */
  private async resolveOpenReports(
    type: ContentType,
    targetId: string,
    resolution: Resolution,
    session: ClientSession,
  ): Promise<ResolvedReports> {
    const open = await this.reportModel
      .find(
        {
          targetType: type,
          targetId: new Types.ObjectId(targetId),
          status: ReportStatus.OPEN,
        },
        { reporterId: 1 },
        { session },
      )
      .lean()
      .exec();
    if (open.length === 0) return NO_REPORTS;

    await this.reportModel
      .updateMany(
        { _id: { $in: open.map((r) => r._id) }, status: ReportStatus.OPEN },
        { $set: resolution },
        { session },
      )
      .exec();
    return {
      reportIds: open.map((r) => r._id.toString()),
      reporterIds: open.map((r) => r.reporterId.toString()),
    };
  }

  private async notifyAuthor(
    type: NotificationType,
    contentType: ContentType,
    contentId: string,
    snapshot: AuditSnapshot,
  ): Promise<void> {
    if (!snapshot.authorId) return;
    await this.notifications.send(snapshot.authorId, type, {
      contentType,
      contentId,
      title: snapshot.title,
      excerpt: snapshot.excerpt,
    });
  }

  /** One REPORT_RESOLVED per distinct reporter, never the author (D18). */
  private async notifyReporters(
    reporterIds: string[],
    authorId: string,
    outcome: ReportOutcome,
    contentType: ContentType,
    contentId: string,
  ): Promise<void> {
    const recipients = [...new Set(reporterIds)].filter(
      (id) => id !== authorId,
    );
    if (recipients.length === 0) return;
    await this.notifications.sendMany(
      recipients,
      NotificationType.REPORT_RESOLVED,
      { outcome, contentType, contentId },
    );
  }
}
