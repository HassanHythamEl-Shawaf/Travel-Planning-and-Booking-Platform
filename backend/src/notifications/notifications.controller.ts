import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import {
  ListNotificationsQueryDto,
  MarkAllReadResponseDto,
  MarkReadResponseDto,
  PaginatedNotificationsDto,
  UnreadCountDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/** GEN-01: any logged-in account sees and manages only its own notifications. */
@ApiTags('Notifications')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my notifications (GEN-01)',
    description: 'Newest first, page size 10. Use unreadOnly=true to filter.',
  })
  @ApiOkResponse({ type: PaginatedNotificationsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsDto> {
    return this.notifications.list(
      user.sub,
      query.unreadOnly ?? false,
      getPagination(query.page),
    );
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count my unread notifications (GEN-01)' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.notifications.unreadCount(user.sub);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read (GEN-01)' })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkAllReadResponseDto> {
    return this.notifications.markAllRead(user.sub);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark one of my notifications as read (GEN-01)',
    description:
      'Idempotent. Returns 404 for notifications that are not yours.',
  })
  @ApiOkResponse({ type: MarkReadResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<MarkReadResponseDto> {
    return this.notifications.markRead(user.sub, id);
  }
}
