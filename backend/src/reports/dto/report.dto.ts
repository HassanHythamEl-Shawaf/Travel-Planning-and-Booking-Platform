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

import { PageQueryDto } from '../../common/dto/page-query.dto';
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

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const ID = '6650f1c2a1b2c3d4e5f60718';

export class CreateReportDto {
  @ApiProperty({ enum: CONTENT_TYPES, example: 'post' })
  @IsIn(CONTENT_TYPES)
  targetType: ContentType;

  @ApiProperty({ example: ID })
  @IsMongoId()
  targetId: string;

  @ApiProperty({ enum: ReportReason, example: ReportReason.SPAM })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({
    example: 'Advertises an unrelated website in every paragraph.',
    maxLength: REPORT_DETAILS_MAX,
    description: 'Trimmed. Required (1–500 characters) when reason is "other".',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REPORT_DETAILS_MAX)
  details?: string;
}

export class ReportCreatedDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ enum: CONTENT_TYPES })
  targetType: ContentType;

  @ApiProperty({ example: ID })
  targetId: string;

  @ApiProperty({ enum: ReportReason })
  reason: ReportReason;

  @ApiProperty({ enum: [ReportStatus.OPEN], example: ReportStatus.OPEN })
  status: ReportStatus;

  @ApiProperty()
  createdAt: Date;
}

export class ListMyReportsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ReportSnapshotDto {
  @ApiProperty({ example: 'My week in Aswan', nullable: true, type: String })
  title: string | null;

  @ApiProperty({ example: 'First 200 characters of the content…' })
  excerpt: string;
}

export class MyReportItemDto {
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

  @ApiProperty({ type: ReportSnapshotDto })
  snapshot: ReportSnapshotDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ nullable: true, type: Date })
  resolvedAt: Date | null;
}

export class PaginatedMyReportsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [MyReportItemDto] })
  items: MyReportItemDto[];
}
