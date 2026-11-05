import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { toExcerpt } from '../moderation/moderation.types';
import { CreateReportDto } from './dto/report.dto';
import { ReportReason, ReportStatus } from './report.constants';
import { ReportsService } from './reports.service';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });

describe('ReportsService (GEN-09)', () => {
  const reporterId = new Types.ObjectId().toString();
  const authorId = new Types.ObjectId().toString();
  const targetId = new Types.ObjectId().toString();
  const createdAt = new Date('2026-11-05T10:00:00Z');

  let reportModel: Record<string, jest.Mock>;
  let registry: { findVisible: jest.Mock };
  let service: ReportsService;

  const dto = (extra: Partial<CreateReportDto> = {}): CreateReportDto => ({
    targetType: 'post',
    targetId,
    reason: ReportReason.SPAM,
    ...extra,
  });

  const visible = (excerpt = 'Short text') =>
    registry.findVisible.mockResolvedValue({
      id: targetId,
      type: 'post',
      authorId,
      isHidden: false,
      publiclyVisible: true,
      snapshot: { title: 'Aswan', excerpt },
    });

  beforeEach(() => {
    reportModel = {
      exists: jest.fn().mockReturnValue(exec(null)),
      create: jest.fn().mockImplementation(([doc]) =>
        Promise.resolve([
          { ...doc, _id: new Types.ObjectId(), createdAt },
        ]),
      ),
      find: jest.fn(),
      countDocuments: jest.fn().mockReturnValue(exec(0)),
    };
    registry = { findVisible: jest.fn().mockResolvedValue(null) };
    service = new ReportsService(reportModel as never, registry as never);
  });

  describe('create', () => {
    it('stores an open report with a snapshot and returns 201 fields', async () => {
      visible();
      const result = await service.create(reporterId, dto());

      expect(result).toEqual({
        id: expect.any(String),
        targetType: 'post',
        targetId,
        reason: ReportReason.SPAM,
        status: ReportStatus.OPEN,
        createdAt,
      });
      const [[doc]] = reportModel.create.mock.calls[0];
      expect(doc).toMatchObject({
        targetType: 'post',
        reason: ReportReason.SPAM,
        details: null,
        status: ReportStatus.OPEN,
        snapshot: { title: 'Aswan', excerpt: 'Short text' },
      });
      expect(doc.reporterId.toString()).toBe(reporterId);
      expect(doc.targetId.toString()).toBe(targetId);
      expect(doc.snapshot.authorId.toString()).toBe(authorId);
    });

    it('requires details when the reason is "other" (D4)', async () => {
      visible();
      await expect(
        service.create(reporterId, dto({ reason: ReportReason.OTHER })),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(
          reporterId,
          dto({ reason: ReportReason.OTHER, details: '   ' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(registry.findVisible).not.toHaveBeenCalled();

      await service.create(
        reporterId,
        dto({ reason: ReportReason.OTHER, details: '  Fake prices  ' }),
      );
      expect(reportModel.create.mock.calls[0][0][0].details).toBe(
        'Fake prices',
      );
    });

    it('answers 404 for content the reporter cannot see (D3)', async () => {
      await expect(service.create(reporterId, dto())).rejects.toThrow(
        new NotFoundException('Content not found'),
      );
      expect(registry.findVisible).toHaveBeenCalledWith('post', targetId);
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('forbids reporting your own content (D2)', async () => {
      visible();
      await expect(service.create(authorId, dto())).rejects.toThrow(
        new ForbiddenException('You cannot report your own content'),
      );
    });

    it('answers 409 when an open report already exists (D5)', async () => {
      visible();
      reportModel.exists.mockReturnValue(exec({ _id: 'x' }));
      await expect(service.create(reporterId, dto())).rejects.toThrow(
        ConflictException,
      );
      expect(reportModel.exists.mock.calls[0][0]).toMatchObject({
        status: ReportStatus.OPEN,
        targetType: 'post',
      });
      expect(reportModel.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate-key race (E11000) to 409', async () => {
      visible();
      reportModel.create.mockRejectedValue(
        Object.assign(new Error('dup'), { code: 11000 }),
      );
      await expect(service.create(reporterId, dto())).rejects.toThrow(
        new ConflictException('You have already reported this content'),
      );
    });

    it('allows reporting again once earlier reports are resolved', async () => {
      visible();
      // Only OPEN reports block: the duplicate check filters on status open.
      reportModel.exists.mockImplementation((query) =>
        exec(query.status === ReportStatus.OPEN ? null : { _id: 'old' }),
      );
      await expect(service.create(reporterId, dto())).resolves.toMatchObject({
        status: ReportStatus.OPEN,
      });
    });

    it('keeps the snapshot excerpt at 200 characters (D11)', async () => {
      visible(toExcerpt('é'.repeat(500)));
      await service.create(reporterId, dto());
      const [[doc]] = reportModel.create.mock.calls[0];
      expect(Array.from(doc.snapshot.excerpt)).toHaveLength(200);
    });

    it('rethrows unexpected errors', async () => {
      visible();
      reportModel.create.mockRejectedValue(new Error('down'));
      await expect(service.create(reporterId, dto())).rejects.toThrow('down');
    });
  });

  describe('listMine', () => {
    it('lists the caller’s reports newest first without admin fields', async () => {
      const chain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue(
          exec([
            {
              _id: new Types.ObjectId(),
              targetType: 'comment',
              targetId: new Types.ObjectId(targetId),
              reason: ReportReason.HARASSMENT,
              details: null,
              status: ReportStatus.DISMISSED,
              snapshot: {
                excerpt: 'rude',
                authorId: new Types.ObjectId(authorId),
              },
              resolvedBy: new Types.ObjectId(),
              resolutionNote: 'internal',
              resolvedAt: createdAt,
              createdAt,
            },
          ]),
        ),
      };
      reportModel.find.mockReturnValue(chain);
      reportModel.countDocuments.mockReturnValue(exec(11));

      const result = await service.listMine(
        reporterId,
        ReportStatus.DISMISSED,
        getPagination(2),
      );

      const query = reportModel.find.mock.calls[0][0];
      expect(query.reporterId.toString()).toBe(reporterId);
      expect(query.status).toBe(ReportStatus.DISMISSED);
      expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(result).toMatchObject({ page: 2, total: 11, totalPages: 2 });
      expect(result.items[0]).toEqual({
        id: expect.any(String),
        targetType: 'comment',
        targetId,
        reason: ReportReason.HARASSMENT,
        details: null,
        status: ReportStatus.DISMISSED,
        snapshot: { title: null, excerpt: 'rude' },
        createdAt,
        resolvedAt: createdAt,
      });
      expect(JSON.stringify(result)).not.toMatch(
        /resolvedBy|resolutionNote|authorId/,
      );
    });
  });
});
