import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
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
import type { ProviderType } from '../auth/decorators/provider-ownership.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { toDate } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';
import {
  AccountStatusChangeDto,
  AdminResetPasswordDto,
  CreateModeratorDto,
  ListAccountsQueryDto,
  ListBookingsQueryDto,
} from './dto/admin-requests.dto';
import {
  AccountStatusResponseDto,
  CreatedModeratorDto,
  PaginatedAccountsDto,
  PaginatedAdminBookingsDto,
  ProviderStatusResponseDto,
  ResetPasswordResponseDto,
} from './dto/admin-responses.dto';

const PROVIDER_TYPE_ENUM = { airline: 'airline', hotel: 'hotel' } as const;
const providerTypePipe = new ParseEnumPipe(PROVIDER_TYPE_ENUM);

const ID_PARAM = { name: 'id', example: '6650f1c2a1b2c3d4e5f60718' } as const;
const TYPE_PARAM = { name: 'type', enum: ['airline', 'hotel'] } as const;

@ApiTags('Administration')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({ description: 'Administrator role required' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Post('moderators')
  @ApiOperation({
    summary: 'Create a hotel or airline moderator (ACC-13)',
    description:
      'Creates a moderator linked to exactly one provider, with an admin-set temporary password that must be changed at first login. The account, its assignment and the audit entry are written in one transaction.',
  })
  @ApiCreatedResponse({ type: CreatedModeratorDto })
  @ApiBadRequestResponse({ description: 'Invalid input' })
  @ApiNotFoundResponse({ description: 'Airline not found / Hotel not found' })
  @ApiConflictResponse({
    description: 'Email is already registered, or the provider is deactivated',
  })
  createModerator(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateModeratorDto,
  ): Promise<CreatedModeratorDto> {
    return this.admin.createModerator(admin.sub, dto);
  }

  @Get('accounts')
  @ApiOperation({
    summary: 'List all accounts (ACC-14)',
    description:
      'Newest first, page size 10. Search name or email (case-insensitive, literal), filter by role and status. Moderator rows include their assignment.',
  })
  @ApiOkResponse({ type: PaginatedAccountsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  listAccounts(
    @Query() query: ListAccountsQueryDto,
  ): Promise<PaginatedAccountsDto> {
    return this.admin.listAccounts(query, getPagination(query.page));
  }

  @Patch('accounts/:id/suspend')
  @ApiOperation({
    summary: 'Suspend a user or moderator account (ACC-15, ACC-16)',
    description:
      'Only from active. Ends all sessions immediately. Bookings and content are not changed. The account is notified.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AccountStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  @ApiForbiddenResponse({
    description: 'Administrator accounts cannot be suspended',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({
    description: 'Account is already suspended, or is deactivated',
  })
  @ApiInternalServerErrorResponse({ description: 'Audit entry not recorded' })
  suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AccountStatusChangeDto,
  ): Promise<AccountStatusResponseDto> {
    return this.admin.suspendAccount(admin.sub, id, dto?.reason);
  }

  @Patch('accounts/:id/reactivate')
  @ApiOperation({
    summary:
      'Reactivate a suspended user or moderator account (ACC-15, ACC-16)',
    description:
      'Only from suspended. Clears the login lockout. A moderator regains access to the same provider.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AccountStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  @ApiForbiddenResponse({
    description: 'Administrator accounts cannot be reactivated',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({ description: 'Account is not suspended' })
  @ApiInternalServerErrorResponse({ description: 'Audit entry not recorded' })
  reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AccountStatusChangeDto,
  ): Promise<AccountStatusResponseDto> {
    return this.admin.reactivateAccount(admin.sub, id, dto?.reason);
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reset a user's or moderator's password (ACC-07a)",
    description:
      'Sets an admin-chosen temporary password, ends all sessions and clears the lockout. The account must set a compliant password at next login. Allowed for active and suspended accounts.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body' })
  @ApiForbiddenResponse({
    description: 'Administrator passwords cannot be reset',
  })
  @ApiNotFoundResponse({ description: 'Account not found' })
  @ApiConflictResponse({ description: 'Account is deactivated' })
  @ApiInternalServerErrorResponse({ description: 'Audit entry not recorded' })
  resetPassword(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdminResetPasswordDto,
  ): Promise<ResetPasswordResponseDto> {
    return this.admin.resetPassword(admin.sub, id, dto.temporaryPassword);
  }

  @Patch('providers/:type/:id/deactivate')
  @ApiOperation({
    summary: 'Deactivate a hotel or airline (ACC-15)',
    description:
      'Hides the provider from search and blocks new bookings; existing confirmed bookings stay valid. Its moderators lose management access until reactivation. Moderators and users with upcoming confirmed bookings are notified.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ProviderStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid provider type or id' })
  @ApiNotFoundResponse({ description: 'Airline not found / Hotel not found' })
  @ApiConflictResponse({ description: 'Provider is already deactivated' })
  @ApiInternalServerErrorResponse({ description: 'Audit entry not recorded' })
  deactivateProvider(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('type', providerTypePipe) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.admin.setProviderActive(admin.sub, type, id, false);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiOperation({
    summary: 'Reactivate a hotel or airline (ACC-15)',
    description:
      'Makes the provider searchable and bookable again and restores its moderators. Affected users are notified.',
  })
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: ProviderStatusResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid provider type or id' })
  @ApiNotFoundResponse({ description: 'Airline not found / Hotel not found' })
  @ApiConflictResponse({ description: 'Provider is already active' })
  @ApiInternalServerErrorResponse({ description: 'Audit entry not recorded' })
  reactivateProvider(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('type', providerTypePipe) type: ProviderType,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProviderStatusResponseDto> {
    return this.admin.setProviderActive(admin.sub, type, id, true);
  }

  @Get('bookings')
  @ApiOperation({
    summary: 'List all flight and hotel bookings, read-only (ACC-17)',
    description:
      'One list over both booking types, newest first, page size 10. Filter by type, status and an inclusive createdAt range.',
  })
  @ApiOkResponse({ type: PaginatedAdminBookingsDto })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters, or "from" is after "to"',
  })
  listBookings(
    @Query() query: ListBookingsQueryDto,
  ): Promise<PaginatedAdminBookingsDto> {
    return this.admin.listBookings(
      {
        type: query.type,
        status: query.status,
        from: toDate(query.from),
        to: toDate(query.to),
      },
      getPagination(query.page),
    );
  }
}
