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
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import {
  CreatePostDto,
  DeletedDto,
  ListMyPostsQueryDto,
  ListPostsQueryDto,
  PaginatedMyPostsDto,
  PaginatedPostsDto,
  PostDetailDto,
  UpdatePostDto,
} from './dto/post.dto';
import { OptionalAuthGuard, OptionalCurrentUser } from './optional-auth.guard';
import { PostsService } from './posts.service';

export const ID_PARAM = {
  name: 'id',
  example: '6650f1c2a1b2c3d4e5f60718',
} as const;

const NOT_OWNER = 'You can see the post but are not its author';
const NOT_FOUND =
  'Post not found, or not visible to you (drafts, hidden posts and posts of deactivated authors)';

@ApiTags('Blog')
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create a blog post (BLG-01, BLG-08)',
    description:
      'Saved as a draft unless status is "published". Tags are trimmed, lowercased and deduplicated (max 5). Drafts are visible only to their author.',
  })
  @ApiCreatedResponse({ type: PostDetailDto })
  @ApiBadRequestResponse({
    description: 'Invalid title, content, tags or status',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Only travellers can write posts' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePostDto,
  ): Promise<PostDetailDto> {
    return this.posts.create(user, dto);
  }

  @Get()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Browse and search published posts (BLG-02, BLG-09)',
    description:
      'Public. "q" matches the title, tags or author name (case-insensitive, literal). Ordered by likes + comments, then newest first. Page size 10; an empty "items" means no results.',
  })
  @ApiOkResponse({ type: PaginatedPostsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  list(@Query() query: ListPostsQueryDto): Promise<PaginatedPostsDto> {
    return this.posts.listPublished(
      { q: query.q, tag: query.tag, authorId: query.authorId },
      getPagination(query.page),
    );
  }

  // Registered before GET /posts/:id so "mine" is not parsed as an id.
  @Get('mine')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'List my posts, drafts included (BLG-03)',
    description:
      'Both statuses (filter with "status"), hidden posts included with isHidden: true. Most recently updated first, page size 10.',
  })
  @ApiOkResponse({ type: PaginatedMyPostsDto })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyPostsQueryDto,
  ): Promise<PaginatedMyPostsDto> {
    return this.posts.listMine(user, query.status, getPagination(query.page));
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Read a post (BLG-02)',
    description:
      'Public for published posts. Drafts only for their author; hidden posts only for the author and admins. "status" and "isHidden" are shown only to the author and admins.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: PostDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @OptionalCurrentUser() viewer: AuthenticatedUser | undefined,
  ): Promise<PostDetailDto> {
    return this.posts.findOne(id, viewer);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my post (BLG-04, BLG-08)',
    description:
      'Any of title, content, tags, status. Publishing sets publishedAt the first time only; a post can go back to draft. A hidden post stays hidden.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: PostDetailDto })
  @ApiBadRequestResponse({ description: 'Invalid id or body, or nothing to update' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: NOT_OWNER })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdatePostDto,
  ): Promise<PostDetailDto> {
    return this.posts.update(id, user, dto);
  }

  @Delete(':id')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my post (BLG-04)',
    description:
      'Permanent. Deletes the post with its comments and likes, and closes open reports on them as content_deleted.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: DeletedDto })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: NOT_OWNER })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DeletedDto> {
    return this.posts.remove(id, user);
  }
}
