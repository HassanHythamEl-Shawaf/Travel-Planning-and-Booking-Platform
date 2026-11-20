import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Paginated, Pagination } from '../common/pagination';
import { ModerationRegistry } from '../moderation/moderation.registry';
import {
  CreateReportDto,
  MyReportItemDto,
  ReportCreatedDto,
} from './dto/report.dto';
import { ReportReason, ReportStatus } from './report.constants';
import { Report } from './schemas/report.schema';

export const DUPLICATE_REPORT = 'You have already reported this content';

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/** User side of content reports (GEN-09). */
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    private readonly registry: ModerationRegistry,
  ) {}

  async create(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<ReportCreatedDto> {
    const details = dto.details?.trim() || null;
    if (dto.reason === ReportReason.OTHER && !details) {
      throw new BadRequestException(
        'Details are required when the reason is "other"',
      );
    }

    // Only content the reporter can see is reportable; never reveal the rest (D3).
    const content = await this.registry.findVisible(
      dto.targetType,
      dto.targetId,
    );
    if (!content) throw new NotFoundException('Content not found');
    if (content.authorId === reporterId) {
      throw new ForbiddenException('You cannot report your own content');
    }

    const key = {
      reporterId: new Types.ObjectId(reporterId),
      targetType: dto.targetType,
      targetId: new Types.ObjectId(dto.targetId),
    };
    if (
      await this.reportModel
        .exists({ ...key, status: ReportStatus.OPEN })
        .exec()
    ) {
      throw new ConflictException(DUPLICATE_REPORT);
    }

    try {
      const [report] = await this.reportModel.create([
        {
          ...key,
          reason: dto.reason,
          details,
          status: ReportStatus.OPEN,
          snapshot: {
            title: content.snapshot.title,
            excerpt: content.snapshot.excerpt,
            authorId: new Types.ObjectId(content.authorId),
          },
        },
      ]);
      return {
        id: report._id.toString(),
        targetType: report.targetType,
        targetId: report.targetId.toString(),
        reason: report.reason,
        status: ReportStatus.OPEN,
        createdAt: report.createdAt,
      };
    } catch (error) {
      // Two identical reports at once: the partial unique index wins (D5).
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(DUPLICATE_REPORT);
      }
      throw error;
    }
  }

  async listMine(
    reporterId: string,
    status: ReportStatus | undefined,
    page: Pagination,
  ): Promise<Paginated<MyReportItemDto>> {
    const query = {
      reporterId: new Types.ObjectId(reporterId),
      ...(status && { status }),
    };
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
    return {
      // No resolvedBy / resolutionNote: those are for admins only.
      items: docs.map((doc) => ({
        id: doc._id.toString(),
        targetType: doc.targetType,
        targetId: doc.targetId.toString(),
        reason: doc.reason,
        details: doc.details ?? null,
        status: doc.status,
        snapshot: {
          title: doc.snapshot?.title ?? null,
          excerpt: doc.snapshot?.excerpt ?? '',
        },
        createdAt: doc.createdAt,
        resolvedAt: doc.resolvedAt ?? null,
      })),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }
}
