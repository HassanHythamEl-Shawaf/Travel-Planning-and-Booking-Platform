import {
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { LikeStateDto } from './dto/comment.dto';
import { LikesService } from './likes.service';
import { ID_PARAM } from './posts.controller';

const NOT_LIKEABLE = 'Post not found, not published, or hidden';

@ApiTags('Blog')
@ApiCookieAuth('access_token')
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({ description: 'Only travellers can like posts' })
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.USER)
@Controller('posts')
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Post(':id/like')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Like a post (BLG-06)',
    description:
      'Idempotent: liking twice keeps one like. Authors may like their own post.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: LikeStateDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: NOT_LIKEABLE })
  like(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LikeStateDto> {
    return this.likes.like(id, user);
  }

  @Delete(':id/like')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove my like (BLG-06)',
    description: 'Idempotent: removing a like that does not exist is a no-op.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: LikeStateDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: NOT_LIKEABLE })
  unlike(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LikeStateDto> {
    return this.likes.unlike(id, user);
  }
}
