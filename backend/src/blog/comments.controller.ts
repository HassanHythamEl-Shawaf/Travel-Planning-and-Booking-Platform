import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { PageQueryDto } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { CommentsService } from './comments.service';
import {
  CommentBodyDto,
  CommentDto,
  PaginatedCommentsDto,
} from './dto/comment.dto';
import { DeletedDto } from './dto/post.dto';
import { OptionalAuthGuard, OptionalCurrentUser } from './optional-auth.guard';
import { ID_PARAM } from './posts.controller';

const COMMENT_NOT_FOUND = 'Comment not found, or not visible to you';

@ApiTags('Blog')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('posts/:id/comments')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'List the comments of a post (BLG-05)',
    description:
      'Public for posts you can see. Oldest first, page size 10. Hidden comments are shown only to their author and admins; comments of deactivated accounts show "Deleted user".',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: PaginatedCommentsDto })
  @ApiBadRequestResponse({ description: 'Invalid id or page' })
  @ApiNotFoundResponse({ description: 'Post not found, or not visible to you' })
  list(
    @Param('id', ParseObjectIdPipe) postId: string,
    @OptionalCurrentUser() viewer: AuthenticatedUser | undefined,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedCommentsDto> {
    return this.comments.list(postId, viewer, getPagination(query.page));
  }

  @Post('posts/:id/comments')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Comment on a published post (BLG-05)',
    description: 'Trimmed, 1–500 characters. Only on published, visible posts.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ type: CommentDto })
  @ApiBadRequestResponse({ description: 'Invalid id or content' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Only travellers can comment' })
  @ApiNotFoundResponse({
    description: 'Post not found, not published, or hidden',
  })
  create(
    @Param('id', ParseObjectIdPipe) postId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.create(postId, user, dto.content);
  }

  @Patch('comments/:id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my comment (BLG-07)',
    description: 'Sets editedAt. Allowed even if the post was later hidden.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: CommentDto })
  @ApiBadRequestResponse({ description: 'Invalid id or content' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description: 'You can see the comment but did not write it',
  })
  @ApiNotFoundResponse({ description: COMMENT_NOT_FOUND })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.update(id, user, dto.content);
  }

  @Delete('comments/:id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my comment (BLG-07)',
    description:
      'Permanent. Open reports on the comment are closed as content_deleted. Post authors cannot delete other people\'s comments.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: DeletedDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({
    description: 'You can see the comment but did not write it',
  })
  @ApiNotFoundResponse({ description: COMMENT_NOT_FOUND })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeletedDto> {
    return this.comments.remove(id, user);
  }
}
