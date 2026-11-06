import {
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { AuditAction } from '../audit-logs/audit-log.constants';
import type { ModeratableContent } from '../moderation/moderation.types';
import { NotificationType } from '../notifications/notification.constants';
import { ReportStatus } from './report.constants';
import { ModerationService } from './moderation.service';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });
const leanExec = (value: unknown) => ({ lean: () => exec(value) });

describe('ModerationService (GEN-10)', () => {
  const adminId = new Types.ObjectId().toString();
  const reportId = new Types.ObjectId().toString();
  const targetId = new Types.ObjectId().toString();
  const authorId = new Types.ObjectId().toString();
  const bob = new Types.ObjectId();
  const carol = new Types.ObjectId();
  const session = { id: 'session' };

  /** Records the order of side effects across mocks. */
  let events: string[];
  let committed: boolean;
  let connection: { transaction: jest.Mock };
  let reportModel: Record<string, jest.Mock>;
  let handler: {
    find: jest.Mock;
    setHidden: jest.Mock;
    delete?: jest.Mock;
    afterDelete?: jest.Mock;
  };
  let registry: { get: jest.Mock };
  let auditLogs: { record: jest.Mock };
  let notifications: { send: jest.Mock; sendMany: jest.Mock };
  let service: ModerationService;

  const content = (
    extra: Partial<ModeratableContent> = {},
  ): ModeratableContent => ({
    id: targetId,
    type: 'post',
    authorId,
    isHidden: false,
    publiclyVisible: true,
    snapshot: { title: 'Aswan', excerpt: 'Visit our shop' },
    ...extra,
  });

  const storedReport = (status = ReportStatus.OPEN) => ({
    _id: new Types.ObjectId(reportId),
    reporterId: bob,
    targetType: 'post',
    targetId: new Types.ObjectId(targetId),
    status,
    snapshot: {
      title: 'Aswan',
      excerpt: 'Visit our shop',
      authorId: new Types.ObjectId(authorId),
    },
  });

  /** Other open reports on the same target (after the claim). */
  const otherOpen = (...reporters: Types.ObjectId[]) =>
    reportModel.find.mockReturnValue(
      leanExec(
        reporters.map((reporterId) => ({
          _id: new Types.ObjectId(),
          reporterId,
        })),
      ),
    );

  beforeEach(() => {
    events = [];
    committed = false;
    connection = {
      transaction: jest.fn(async (fn: (s: unknown) => unknown) => {
        const result = await fn(session);
        committed = true;
        events.push('commit');
        return result;
      }),
    };
    reportModel = {
      findById: jest.fn().mockReturnValue(leanExec(storedReport())),
      updateOne: jest.fn().mockImplementation(() => {
        events.push('claim');
        return exec({ matchedCount: 1, modifiedCount: 1 });
      }),
      find: jest.fn().mockReturnValue(leanExec([])),
      updateMany: jest.fn().mockImplementation(() => {
        events.push('cascade');
        return exec({ modifiedCount: 1 });
      }),
    };
    handler = {
      find: jest.fn().mockResolvedValue(content()),
      setHidden: jest.fn().mockImplementation(() => {
        events.push('setHidden');
        return Promise.resolve(true);
      }),
      delete: jest.fn().mockResolvedValue(true),
    };
    registry = { get: jest.fn().mockReturnValue(handler) };
    auditLogs = {
      record: jest.fn().mockImplementation(() => {
        events.push('audit');
        return Promise.resolve();
      }),
    };
    notifications = {
      send: jest.fn().mockImplementation(() => {
        events.push(`notify:${committed}`);
        return Promise.resolve();
      }),
      sendMany: jest.fn().mockImplementation(() => {
        events.push(`notifyMany:${committed}`);
        return Promise.resolve();
      }),
    };
    service = new ModerationService(
      connection as never,
      reportModel as never,
      registry as never,
      auditLogs as never,
      notifications as never,
    );
  });

  describe('resolveReport', () => {
    it('dismisses this and every other open report on the target (D8)', async () => {
      otherOpen(carol, bob);

      const result = await service.resolveReport(
        adminId,
        reportId,
        'dismiss',
        ' not spam ',
      );

      expect(result).toEqual({
        id: reportId,
        status: ReportStatus.DISMISSED,
        resolvedReports: 3,
      });
      const [claimFilter, claimUpdate, claimOptions] =
        reportModel.updateOne.mock.calls[0];
      expect(claimFilter).toEqual({
        _id: new Types.ObjectId(reportId),
        status: ReportStatus.OPEN,
      });
      expect(claimUpdate.$set).toMatchObject({
        status: ReportStatus.DISMISSED,
        resolutionNote: 'not spam',
      });
      expect(claimUpdate.$set.resolvedBy.toString()).toBe(adminId);
      expect(claimOptions).toEqual({ session });

      // Cascade is scoped to this target only.
      const [findFilter, , findOptions] = reportModel.find.mock.calls[0];
      expect(findFilter).toEqual({
        targetType: 'post',
        targetId: new Types.ObjectId(targetId),
        status: ReportStatus.OPEN,
      });
      expect(findOptions).toEqual({ session });
      expect(reportModel.updateMany.mock.calls[0][0].status).toBe(
        ReportStatus.OPEN,
      );
      expect(handler.find).not.toHaveBeenCalled();
      expect(handler.setHidden).not.toHaveBeenCalled();
    });

    it('audits the dismissal with report ids and the stored snapshot (D19)', async () => {
      otherOpen(carol);
      await service.resolveReport(adminId, reportId, 'dismiss');

      const [entry, auditSession] = auditLogs.record.mock.calls[0];
      expect(auditSession).toBe(session);
      expect(entry).toMatchObject({
        actorId: adminId,
        action: AuditAction.REPORT_DISMISSED,
        targetType: 'post',
        targetId,
        details: {
          snapshot: { title: 'Aswan', excerpt: 'Visit our shop', authorId },
          note: null,
        },
      });
      expect(entry.details.reportIds).toHaveLength(2);
      expect(entry.details.reportIds[0]).toBe(reportId);
    });

    it('notifies each distinct reporter after commit, never the author on dismiss', async () => {
      otherOpen(carol, bob);
      await service.resolveReport(adminId, reportId, 'dismiss');

      expect(notifications.send).not.toHaveBeenCalled();
      expect(notifications.sendMany).toHaveBeenCalledTimes(1);
      const [recipients, type, payload] = notifications.sendMany.mock.calls[0];
      expect(recipients).toEqual([bob.toString(), carol.toString()]);
      expect(type).toBe(NotificationType.REPORT_RESOLVED);
      expect(payload).toEqual({
        outcome: 'no_violation',
        contentType: 'post',
        contentId: targetId,
      });
      expect(events.indexOf('commit')).toBeLessThan(
        events.indexOf('notifyMany:true'),
      );
    });

    it('hides the content and notifies author and reporters (action_taken)', async () => {
      otherOpen(carol);
      const result = await service.resolveReport(adminId, reportId, 'hide');

      expect(result).toEqual({
        id: reportId,
        status: ReportStatus.CONTENT_HIDDEN,
        resolvedReports: 2,
      });
      expect(handler.find).toHaveBeenCalledWith(targetId, session);
      expect(handler.setHidden).toHaveBeenCalledWith(targetId, true, session);
      expect(auditLogs.record.mock.calls[0][0]).toMatchObject({
        action: AuditAction.CONTENT_HIDDEN,
      });
      expect(auditLogs.record.mock.calls[0][0].details).not.toHaveProperty(
        'alreadyHidden',
      );
      expect(notifications.send).toHaveBeenCalledWith(
        authorId,
        NotificationType.CONTENT_HIDDEN,
        {
          contentType: 'post',
          contentId: targetId,
          title: 'Aswan',
          excerpt: 'Visit our shop',
        },
      );
      expect(notifications.sendMany.mock.calls[0][2].outcome).toBe(
        'action_taken',
      );
      expect(events).toEqual([
        'claim',
        'setHidden',
        'cascade',
        'audit',
        'commit',
        'notify:true',
        'notifyMany:true',
      ]);
    });

    it('records alreadyHidden and skips the author when content was hidden already', async () => {
      handler.find.mockResolvedValue(content({ isHidden: true }));
      await service.resolveReport(adminId, reportId, 'hide');

      expect(handler.setHidden).not.toHaveBeenCalled();
      expect(auditLogs.record.mock.calls[0][0].details.alreadyHidden).toBe(
        true,
      );
      expect(notifications.send).not.toHaveBeenCalled();
      expect(notifications.sendMany).toHaveBeenCalledTimes(1);
    });

    it('answers 404 when hiding content its owner already deleted (D23)', async () => {
      handler.find.mockResolvedValue(null);
      await expect(
        service.resolveReport(adminId, reportId, 'hide'),
      ).rejects.toThrow(new NotFoundException('Content not found'));
      expect(reportModel.updateOne).not.toHaveBeenCalled();
      expect(notifications.sendMany).not.toHaveBeenCalled();
    });

    it('still dismisses a report whose content was deleted (D23)', async () => {
      handler.find.mockResolvedValue(null);
      await expect(
        service.resolveReport(adminId, reportId, 'dismiss'),
      ).resolves.toMatchObject({ status: ReportStatus.DISMISSED });
    });

    it('answers 404 for a missing report and 409 for a resolved one', async () => {
      reportModel.findById.mockReturnValue(leanExec(null));
      await expect(
        service.resolveReport(adminId, reportId, 'dismiss'),
      ).rejects.toThrow(new NotFoundException('Report not found'));

      reportModel.findById.mockReturnValue(
        leanExec(storedReport(ReportStatus.DISMISSED)),
      );
      await expect(
        service.resolveReport(adminId, reportId, 'hide'),
      ).rejects.toThrow(new ConflictException('Report is already resolved'));
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('answers 409 when another admin claimed the report first (D13)', async () => {
      reportModel.updateOne.mockReturnValue(
        exec({ matchedCount: 0, modifiedCount: 0 }),
      );
      await expect(
        service.resolveReport(adminId, reportId, 'dismiss'),
      ).rejects.toThrow(ConflictException);
      expect(auditLogs.record).not.toHaveBeenCalled();
      expect(notifications.sendMany).not.toHaveBeenCalled();
    });

    it('aborts without notifying when the audit write fails (D12)', async () => {
      auditLogs.record.mockRejectedValue(new Error('audit down'));
      await expect(
        service.resolveReport(adminId, reportId, 'hide'),
      ).rejects.toThrow('audit down');
      expect(committed).toBe(false);
      // Every write ran inside the transaction session, so the abort undoes them.
      expect(handler.setHidden.mock.calls[0][2]).toBe(session);
      expect(reportModel.updateOne.mock.calls[0][2]).toEqual({ session });
      expect(notifications.send).not.toHaveBeenCalled();
      expect(notifications.sendMany).not.toHaveBeenCalled();
    });

    it('never notifies the author as a reporter', async () => {
      otherOpen(new Types.ObjectId(authorId));
      await service.resolveReport(adminId, reportId, 'dismiss');
      expect(notifications.sendMany.mock.calls[0][0]).toEqual([
        bob.toString(),
      ]);
    });
  });

  describe('setVisibility', () => {
    it('hides content without a report and resolves its open reports', async () => {
      otherOpen(bob, carol);
      const result = await service.setVisibility(
        adminId,
        'review',
        targetId,
        true,
      );

      expect(registry.get).toHaveBeenCalledWith('review');
      expect(result).toEqual({
        targetType: 'review',
        targetId,
        isHidden: true,
        resolvedReports: 2,
      });
      expect(reportModel.updateMany.mock.calls[0][1].$set.status).toBe(
        ReportStatus.CONTENT_HIDDEN,
      );
      expect(auditLogs.record.mock.calls[0][0]).toMatchObject({
        action: AuditAction.CONTENT_HIDDEN,
        targetType: 'review',
      });
      expect(notifications.send.mock.calls[0][1]).toBe(
        NotificationType.CONTENT_HIDDEN,
      );
      expect(notifications.sendMany.mock.calls[0][0]).toEqual([
        bob.toString(),
        carol.toString(),
      ]);
    });

    it('unhides without touching reports (D10)', async () => {
      handler.find.mockResolvedValue(content({ isHidden: true }));
      const result = await service.setVisibility(
        adminId,
        'post',
        targetId,
        false,
      );

      expect(result.resolvedReports).toBe(0);
      expect(handler.setHidden).toHaveBeenCalledWith(targetId, false, session);
      expect(reportModel.find).not.toHaveBeenCalled();
      expect(reportModel.updateMany).not.toHaveBeenCalled();
      expect(auditLogs.record.mock.calls[0][0]).toMatchObject({
        action: AuditAction.CONTENT_UNHIDDEN,
        details: { reportIds: [] },
      });
      expect(notifications.send.mock.calls[0][1]).toBe(
        NotificationType.CONTENT_UNHIDDEN,
      );
      expect(notifications.sendMany).not.toHaveBeenCalled();
    });

    it('answers 409 when already in that state and 404 when missing', async () => {
      handler.find.mockResolvedValue(content({ isHidden: true }));
      await expect(
        service.setVisibility(adminId, 'post', targetId, true),
      ).rejects.toThrow(new ConflictException('Content is already hidden'));

      handler.find.mockResolvedValue(content({ isHidden: false }));
      await expect(
        service.setVisibility(adminId, 'post', targetId, false),
      ).rejects.toThrow(new ConflictException('Content is not hidden'));

      // Lost a race between find and the conditional update.
      handler.setHidden.mockResolvedValue(false);
      await expect(
        service.setVisibility(adminId, 'post', targetId, true),
      ).rejects.toThrow(ConflictException);

      handler.find.mockResolvedValue(null);
      await expect(
        service.setVisibility(adminId, 'post', targetId, true),
      ).rejects.toThrow(NotFoundException);
      expect(auditLogs.record).not.toHaveBeenCalled();
    });
  });

  describe('deleteContent', () => {
    it('deletes, resolves reports as content_deleted and audits the snapshot', async () => {
      otherOpen(bob, bob, carol);
      const result = await service.deleteContent(
        adminId,
        'post',
        targetId,
        'spam',
      );

      expect(result).toEqual({
        targetType: 'post',
        targetId,
        deleted: true,
        resolvedReports: 3,
      });
      expect(handler.delete).toHaveBeenCalledWith(targetId, session);
      expect(reportModel.updateMany.mock.calls[0][1].$set.status).toBe(
        ReportStatus.CONTENT_DELETED,
      );
      const entry = auditLogs.record.mock.calls[0][0];
      expect(entry).toMatchObject({
        action: AuditAction.CONTENT_DELETED,
        details: {
          snapshot: { title: 'Aswan', excerpt: 'Visit our shop', authorId },
          note: 'spam',
        },
      });
      expect(entry.details.reportIds).toHaveLength(3);
      expect(notifications.send.mock.calls[0]).toEqual([
        authorId,
        NotificationType.CONTENT_DELETED,
        expect.objectContaining({ title: 'Aswan', excerpt: 'Visit our shop' }),
      ]);
      // Deduplicated reporters.
      expect(notifications.sendMany.mock.calls[0][0]).toEqual([
        bob.toString(),
        carol.toString(),
      ]);
    });

    it('answers 501 when the handler cannot delete (D16)', async () => {
      delete handler.delete;
      await expect(
        service.deleteContent(adminId, 'review', targetId),
      ).rejects.toThrow(
        new NotImplementedException(
          'Deleting this content type is not available yet',
        ),
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('runs afterDelete after the commit with the content found in the transaction', async () => {
      const found = content({ assets: ['img-1', 'img-2'] });
      handler.find.mockResolvedValue(found);
      handler.afterDelete = jest.fn().mockImplementation(() => {
        events.push(`afterDelete:${committed}`);
        return Promise.resolve();
      });

      await service.deleteContent(adminId, 'post', targetId);

      expect(handler.afterDelete).toHaveBeenCalledWith(found);
      expect(events.indexOf('afterDelete:true')).toBeGreaterThan(
        events.indexOf('commit'),
      );
      expect(events).not.toContain('afterDelete:false');
    });

    it('still succeeds and notifies when afterDelete fails', async () => {
      handler.afterDelete = jest.fn().mockRejectedValue(new Error('disk'));

      await expect(
        service.deleteContent(adminId, 'post', targetId),
      ).resolves.toMatchObject({ deleted: true });
      expect(notifications.send).toHaveBeenCalled();
    });

    it('never runs afterDelete when the delete is rolled back', async () => {
      handler.afterDelete = jest.fn().mockResolvedValue(undefined);
      auditLogs.record.mockRejectedValue(new Error('audit down'));

      await expect(
        service.deleteContent(adminId, 'post', targetId),
      ).rejects.toThrow('audit down');
      expect(handler.afterDelete).not.toHaveBeenCalled();
    });

    it('answers 404 when the content is gone', async () => {
      handler.find.mockResolvedValue(null);
      await expect(
        service.deleteContent(adminId, 'comment', targetId),
      ).rejects.toThrow(NotFoundException);

      handler.find.mockResolvedValue(content());
      handler.delete!.mockResolvedValue(false);
      await expect(
        service.deleteContent(adminId, 'comment', targetId),
      ).rejects.toThrow(NotFoundException);
      expect(auditLogs.record).not.toHaveBeenCalled();
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });
});
