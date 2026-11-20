import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { PageQueryDto } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { PaginatedPostsDto } from './dto/post.dto';
import { OptionalAuthGuard } from './optional-auth.guard';
import { PostsService } from './posts.service';

@ApiTags('Blog')
@Controller('tags')
export class TagsController {
  constructor(private readonly posts: PostsService) {}

  @Get(':tag/posts')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'List published posts with a tag (BLG-08)',
    description:
      'Public. The tag is trimmed and lowercased. Same order as the post search (likes + comments, then newest). Page size 10.',
  })
  @ApiParam({ name: 'tag', example: 'egypt' })
  @ApiOkResponse({ type: PaginatedPostsDto })
  @ApiBadRequestResponse({ description: 'Invalid tag or page' })
  list(
    @Param('tag') tag: string,
    @Query() query: PageQueryDto,
  ): Promise<PaginatedPostsDto> {
    return this.posts.listPublished({ tag }, getPagination(query.page));
  }
}
