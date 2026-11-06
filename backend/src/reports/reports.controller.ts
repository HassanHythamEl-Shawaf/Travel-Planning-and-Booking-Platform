import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
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
import {
  CreateReportDto,
  ListMyReportsQueryDto,
  PaginatedMyReportsDto,
  ReportCreatedDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

/** GEN-09: any logged-in account reports content it can see. */
@ApiTags('Reports')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: 'Report a post, comment, hotel review or itinerary (GEN-09)',
    description:
      'Only content you can currently see is reportable. One open report per account per item; once it is resolved you may report again. "details" is required when the reason is "other".',
  })
  @ApiCreatedResponse({ type: ReportCreatedDto })
  @ApiBadRequestResponse({
    description:
      'Invalid input, or reason "other" without details (max 500 characters)',
  })
  @ApiForbiddenResponse({ description: 'You cannot report your own content' })
  @ApiNotFoundResponse({ description: 'Content not found' })
  @ApiConflictResponse({
    description: 'You have already reported this content',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateReportDto,
  ): Promise<ReportCreatedDto> {
    return this.reports.create(user.sub, dto);
  }

  @Get('mine')
  @ApiOperation({
    summary: 'List my reports and their status (GEN-09)',
    description: 'Newest first, page size 10. Filter by status.',
  })
  @ApiOkResponse({ type: PaginatedMyReportsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyReportsQueryDto,
  ): Promise<PaginatedMyReportsDto> {
    return this.reports.listMine(
      user.sub,
      query.status,
      getPagination(query.page),
    );
  }
}
