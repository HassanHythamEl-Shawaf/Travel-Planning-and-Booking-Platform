import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiNotImplementedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { toDate } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import {
  CONTENT_TYPE_ENUM,
  CONTENT_TYPES,
  type ContentType,
} from '../moderation/moderation.types';
import { UserRole } from '../users/schemas/user.schema';
import { AdminReportsService } from './admin-reports.service';
import {
  ContentDeletedResponseDto,
  ContentVisibilityResponseDto,
  ListAdminReportsQueryDto,
  ModerationNoteDto,
  PaginatedAdminReportsDto,
  ResolveReportDto,
  ResolveReportResponseDto,
} from './dto/admin-report.dto';
import { ModerationService } from './moderation.service';

const contentTypePipe = new ParseEnumPipe(CONTENT_TYPE_ENUM);

const ID_PARAM = { name: 'id', example: '6650f1c2a1b2c3d4e5f60718' } as const;
const TYPE_PARAM = { name: 'type', enum: CONTENT_TYPES } as const;

@ApiTags('Admin – Moderation')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({ description: 'Administrator role required' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminModerationController {
  constructor(
    private readonly reports: AdminReportsService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('reports')
  @ApiOperation({
    summary: 'List content reports (GEN-09, GEN-10)',
    description:
      'Open reports by default ("status=all" for every status), newest first, page size 10. Filter by content type, reason, content id and an inclusive createdAt range. Each row shows the reporter, the content snapshot with its author, and how many open reports the same content has.',
  })
  @ApiOkResponse({ type: PaginatedAdminReportsDto })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters, or "from" is after "to"',
  })
  list(
    @Query() query: ListAdminReportsQueryDto,
  ): Promise<PaginatedAdminReportsDto> {
    return this.reports.list(
      {
        status: query.status,
        targetType: query.targetType,
        reason: query.reason,
        targetId: query.targetId,
        from: toDate(query.from),
        to: toDate(query.to),
      },
      getPagination(query.page),
    );
  }

  @Patch('reports/:id')
  @ApiOperation({
    summary: 'Dismiss a report or hide the reported content (GEN-10)',
    description:
      'Resolves this report and every other open report on the same content with the same outcome, in one transaction with the audit entry. "hide" makes the content visible only to its author and admins. Reporters are notified of the outcome; the author is notified when content is hidden. To delete the content use DELETE /api/admin/content/:type/:id.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ResolveReportResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  @ApiNotFoundResponse({
    description: 'Report not found, or (hide) the content no longer exists',
  })
  @ApiConflictResponse({ description: 'Report is already resolved' })
  @ApiInternalServerErrorResponse({
    description: 'Audit entry not recorded; nothing was changed',
  })
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ResolveReportDto,
  ): Promise<ResolveReportResponseDto> {
    return this.moderation.resolveReport(admin.sub, id, dto.action, dto.note);
  }

  @Patch('content/:type/:id/hide')
  @ApiOperation({
    summary: 'Hide content without a report (GEN-10)',
    description:
      'Hides the content so only its author and admins can see it, and resolves its open reports as content_hidden. The author and the reporters are notified.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ContentVisibilityResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid content type, id or body' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiConflictResponse({ description: 'Content is already hidden' })
  @ApiInternalServerErrorResponse({
    description: 'Audit entry not recorded; nothing was changed',
  })
  hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('type', contentTypePipe) type: ContentType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<ContentVisibilityResponseDto> {
    return this.moderation.setVisibility(admin.sub, type, id, true, dto?.note);
  }

  @Patch('content/:type/:id/unhide')
  @ApiOperation({
    summary: 'Make hidden content visible again (GEN-10)',
    description:
      'Resolved reports stay resolved. The author is notified.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ContentVisibilityResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid content type, id or body' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiConflictResponse({ description: 'Content is not hidden' })
  @ApiInternalServerErrorResponse({
    description: 'Audit entry not recorded; nothing was changed',
  })
  unhide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('type', contentTypePipe) type: ContentType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: ModerationNoteDto,
  ): Promise<ContentVisibilityResponseDto> {
    return this.moderation.setVisibility(admin.sub, type, id, false, dto?.note);
  }

  @Delete('content/:type/:id')
  @ApiOperation({
    summary: 'Delete reported or inappropriate content (GEN-10)',
    description:
      'Deletes the content (a post also loses its comments and likes) and resolves its open reports as content_deleted, in one transaction with the audit entry. The author and the reporters are notified. Reviews and itineraries answer 501 until their owners enable deletion.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ContentDeletedResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid content type, id or note' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiNotImplementedResponse({
    description: 'Deleting this content type is not available yet',
  })
  @ApiInternalServerErrorResponse({
    description: 'Audit entry not recorded; nothing was changed',
  })
  remove(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('type', contentTypePipe) type: ContentType,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ModerationNoteDto,
  ): Promise<ContentDeletedResponseDto> {
    return this.moderation.deleteContent(admin.sub, type, id, query.note);
  }
}
