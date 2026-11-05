import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';
import { ModeratorAssignmentResponseDto } from './dto/admin-responses.dto';

@ApiTags('Moderator')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.MODERATOR)
@Controller('moderator')
export class ModeratorController {
  constructor(private readonly admin: AdminService) {}

  @Get('assignment')
  @ApiOperation({
    summary: 'Get the provider I manage (supports ACC-13)',
    description:
      'Lets the moderator dashboard know which airline or hotel this account manages, and whether it is currently active.',
  })
  @ApiOkResponse({ type: ModeratorAssignmentResponseDto })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Moderator role required' })
  @ApiNotFoundResponse({ description: 'No provider is assigned' })
  getAssignment(
    @CurrentUser() moderator: AuthenticatedUser,
  ): Promise<ModeratorAssignmentResponseDto> {
    return this.admin.getModeratorAssignment(moderator.sub);
  }
}
