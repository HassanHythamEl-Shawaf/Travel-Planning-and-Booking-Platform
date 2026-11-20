import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { NotificationType } from '../notification.constants';

export class ListNotificationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: 'Only unread notifications',
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unreadOnly?: boolean = false;
}

export class NotificationItemDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ enum: NotificationType })
  type: NotificationType;

  @ApiProperty({ example: 'Your booking ABC123 is confirmed.' })
  message: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { bookingReference: 'ABC123' },
  })
  payload: Record<string, unknown>;

  @ApiProperty({ nullable: true, type: Date })
  readAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedNotificationsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [NotificationItemDto] })
  items: NotificationItemDto[];
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 })
  count: number;
}

export class MarkReadResponseDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty()
  readAt: Date;
}

export class MarkAllReadResponseDto {
  @ApiProperty({ example: 3 })
  updated: number;
}
