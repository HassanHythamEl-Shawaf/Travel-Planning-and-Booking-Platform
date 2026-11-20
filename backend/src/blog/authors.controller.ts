import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { PageQueryDto } from '../common/dto/page-query.dto';
import { getPagination } from '../common/pagination';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { AuthorsService } from './authors.service';
import { AuthorPageDto } from './dto/author.dto';
import { OptionalAuthGuard } from './optional-auth.guard';
import { ID_PARAM } from './posts.controller';

@ApiTags('Blog')
@Controller('authors')
export class AuthorsController {
  constructor(private readonly authors: AuthorsService) {}

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public author page (BLG-12)',
    description:
      'Name, join date, published posts (paginated with "page", same order as search) and up to 10 public itineraries. Unknown, deactivated, admin and moderator accounts answer 404.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AuthorPageDto })
  @ApiBadRequestResponse({ description: 'Invalid id or page' })
  @ApiNotFoundResponse({ description: 'Author not found' })
  findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<AuthorPageDto> {
    return this.authors.findOne(id, getPagination(query.page));
  }
}
