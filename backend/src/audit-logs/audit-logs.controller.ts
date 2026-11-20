import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { toDate } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { UserRole } from '../users/schemas/user.schema';
import { AuditLogsService } from './audit-logs.service';
import {
  ListAuditLogsQueryDto,
  PaginatedAuditLogsDto,
} from './dto/audit-log.dto';

@ApiTags('Administration')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogs: AuditLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the admin audit log (GEN-07)',
    description:
      'Append-only log of administrative actions, newest first. Filter by action, actor, target type and an inclusive createdAt range. Page size 10.',
  })
  @ApiOkResponse({ type: PaginatedAuditLogsDto })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters, or "from" is after "to"',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  list(@Query() query: ListAuditLogsQueryDto): Promise<PaginatedAuditLogsDto> {
    return this.auditLogs.list(
      {
        action: query.action,
        actorId: query.actorId,
        targetType: query.targetType,
        from: toDate(query.from),
        to: toDate(query.to),
      },
      getPagination(query.page),
    );
  }
}
