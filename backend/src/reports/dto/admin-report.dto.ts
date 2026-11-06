import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { DateRangePageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  CONTENT_TYPES,
  type ContentType,
} from '../../moderation/moderation.types';
import {
  REPORT_DETAILS_MAX,
  ReportReason,
  ReportStatus,
} from '../report.constants';
import { trim } from './report.dto';

const ID = '6650f1c2a1b2c3d4e5f60718';

export const REPORT_STATUS_FILTERS = [
  ...Object.values(ReportStatus),
  'all',
] as const;
export type ReportStatusFilter = (typeof REPORT_STATUS_FILTERS)[number];

export class ListAdminReportsQueryDto extends DateRangePageQueryDto {
  @ApiPropertyOptional({
    enum: REPORT_STATUS_FILTERS,
    default: ReportStatus.OPEN,
    description: 'Defaults to "open"; "all" shows every status',
  })
  @IsOptional()
  @IsIn(REPORT_STATUS_FILTERS)
  status?: ReportStatusFilter = ReportStatus.OPEN;

  @ApiPropertyOptional({ enum: CONTENT_TYPES })
  @IsOptional()
  @IsIn(CONTENT_TYPES)
  targetType?: ContentType;

  @ApiPropertyOptional({ enum: ReportReason })
  @IsOptional()
  @IsEnum(ReportReason)
  reason?: ReportReason;

  @ApiPropertyOptional({ example: ID })
  @IsOptional()
  @IsMongoId()
  targetId?: string;
}

export const REPORT_ACTIONS = ['dismiss', 'hide'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

const NOTE = {
  example: 'Advertising, confirmed with the reporter screenshots',
  maxLength: REPORT_DETAILS_MAX,
  description: 'Internal note for admins. Never shown to the author or reporters.',
} as const;

export class ModerationNoteDto {
  @ApiPropertyOptional(NOTE)
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REPORT_DETAILS_MAX)
  note?: string;
}

export class ResolveReportDto extends ModerationNoteDto {
  @ApiProperty({ enum: REPORT_ACTIONS, example: 'dismiss' })
  @IsIn(REPORT_ACTIONS)
  action: ReportAction;
}

export class AdminReportPersonDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Sara Ali' })
  name: string;

  @ApiProperty({ example: 'sara@example.com', nullable: true, type: String })
  email: string | null;
}

export class AdminReportSnapshotDto {
  @ApiProperty({ example: 'My week in Aswan', nullable: true, type: String })
  title: string | null;

  @ApiProperty({ example: 'First 200 characters of the content…' })
  excerpt: string;

  @ApiProperty({ example: ID })
  authorId: string;

  @ApiProperty({ example: 'Omar Said' })
  authorName: string;
}

export class AdminReportItemDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ enum: CONTENT_TYPES })
  targetType: ContentType;

  @ApiProperty({ example: ID })
  targetId: string;

  @ApiProperty({ enum: ReportReason })
  reason: ReportReason;

  @ApiProperty({ nullable: true, type: String })
  details: string | null;

  @ApiProperty({ enum: ReportStatus })
  status: ReportStatus;

  @ApiProperty({ type: AdminReportPersonDto })
  reporter: AdminReportPersonDto;

  @ApiProperty({ type: AdminReportSnapshotDto })
  snapshot: AdminReportSnapshotDto;

  @ApiProperty({ example: 2, description: 'Open reports on the same content' })
  openReportsOnTarget: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true, type: String, example: null })
  resolvedBy: string | null;

  @ApiProperty({ nullable: true, type: Date })
  resolvedAt: Date | null;

  @ApiProperty({ nullable: true, type: String })
  resolutionNote: string | null;
}

export class PaginatedAdminReportsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AdminReportItemDto] })
  items: AdminReportItemDto[];
}

export class ResolveReportResponseDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({
    enum: [ReportStatus.DISMISSED, ReportStatus.CONTENT_HIDDEN],
  })
  status: ReportStatus;

  @ApiProperty({
    example: 2,
    description: 'Reports resolved, including this one',
  })
  resolvedReports: number;
}

export class ContentVisibilityResponseDto {
  @ApiProperty({ enum: CONTENT_TYPES })
  targetType: ContentType;

  @ApiProperty({ example: ID })
  targetId: string;

  @ApiProperty()
  isHidden: boolean;

  @ApiProperty({ example: 1 })
  resolvedReports: number;
}

export class ContentDeletedResponseDto {
  @ApiProperty({ enum: CONTENT_TYPES })
  targetType: ContentType;

  @ApiProperty({ example: ID })
  targetId: string;

  @ApiProperty({ example: true })
  deleted: true;

  @ApiProperty({ example: 1 })
  resolvedReports: number;
}
