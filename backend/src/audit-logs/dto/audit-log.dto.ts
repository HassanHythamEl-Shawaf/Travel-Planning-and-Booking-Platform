import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsMongoId, IsOptional } from 'class-validator';

import { DateRangePageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { AuditAction, AuditTargetType } from '../audit-log.constants';

export class ListAuditLogsQueryDto extends DateRangePageQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ example: '6650f1c2a1b2c3d4e5f60718' })
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ enum: AuditTargetType })
  @IsOptional()
  @IsEnum(AuditTargetType)
  targetType?: AuditTargetType;
}

export class AuditLogItemDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60700' })
  actorId: string;

  @ApiProperty({ example: 'Platform Admin', nullable: true, type: String })
  actorName: string | null;

  @ApiProperty({ enum: AuditAction })
  action: AuditAction;

  @ApiProperty({ enum: AuditTargetType })
  targetType: AuditTargetType;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60799' })
  targetId: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { role: 'user', reason: 'Spam' },
  })
  details: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedAuditLogsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AuditLogItemDto] })
  items: AuditLogItemDto[];
}
