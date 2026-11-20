import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

import { PageQueryDto } from '../../common/dto/page-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  POST_CONTENT_MAX,
  POST_STATUSES,
  POST_TITLE_MAX,
  POST_TITLE_MIN,
  type PostStatus,
  SEARCH_QUERY_MAX,
  TAG_MAX_LENGTH,
  TAGS_MAX,
} from '../blog.constants';

export const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const ID = '6650f1c2a1b2c3d4e5f60718';

/** Upper bound on the raw array; the 5-tag limit applies after deduplication. */
const RAW_TAGS_MAX = 50;

// ------------------------------------------------------------- requests

export class CreatePostDto {
  @ApiProperty({
    example: 'Five days in Aswan',
    minLength: POST_TITLE_MIN,
    maxLength: POST_TITLE_MAX,
    description: 'Trimmed.',
  })
  @Transform(trim)
  @IsString()
  @Length(POST_TITLE_MIN, POST_TITLE_MAX)
  title: string;

  @ApiProperty({
    example: 'We took the night train from Cairo and woke up next to the Nile…',
    maxLength: POST_CONTENT_MAX,
    description:
      'Plain text or markdown, stored as written. Must contain a non-space character.',
  })
  @IsString()
  @Length(1, POST_CONTENT_MAX)
  @Matches(/\S/, { message: 'content must not be empty' })
  content: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['egypt', 'nile-cruise'],
    description: `Up to ${TAGS_MAX} tags, each 1–${TAG_MAX_LENGTH} characters of a–z, 0–9 and "-". Trimmed, lowercased and deduplicated.`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(RAW_TAGS_MAX)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    enum: POST_STATUSES,
    default: 'draft',
    description: 'Draft posts are visible only to their author.',
  })
  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: PostStatus;

  @ApiPropertyOptional({
    example: '6650f1c2a1b2c3d4e5f60718',
    nullable: true,
    type: String,
    description:
      'BLG-13 (bonus): id of one of your own itineraries to attach to the post; null removes it. Readers see it only while the itinerary is public and not hidden.',
  })
  @IsOptional()
  @IsMongoId()
  itineraryId?: string | null;
}

/** Any subset; drafts and published posts can move both ways (D3). */
export class UpdatePostDto extends PartialType(CreatePostDto) {}

export class ListPostsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'aswan',
    maxLength: SEARCH_QUERY_MAX,
    description:
      'Case-insensitive keyword matched literally against the title, the tags and the author name (BLG-09).',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX)
  q?: string;

  @ApiPropertyOptional({ example: 'egypt', description: 'Exact tag (normalised).' })
  @IsOptional()
  @IsString()
  tag?: string;

  @ApiPropertyOptional({ example: ID })
  @IsOptional()
  @IsMongoId()
  authorId?: string;
}

export class ListMyPostsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: POST_STATUSES })
  @IsOptional()
  @IsIn(POST_STATUSES)
  status?: PostStatus;
}

// ------------------------------------------------------------ responses

export class AuthorRefDto {
  @ApiProperty({ example: ID, nullable: true, type: String })
  id: string | null;

  @ApiProperty({ example: 'Alice Author' })
  name: string;
}

/** BLG-13 (bonus): the itinerary attached to a post. */
export class AttachedItineraryDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({
    example: true,
    description:
      'False only when the author views their own private itinerary.',
  })
  isPublic: boolean;
}

export class PostImageDto {
  @ApiProperty({ example: 'a1b2c3d4' })
  imageId: string;

  @ApiProperty({ example: '/uploads/posts/a1b2c3d4.jpg' })
  url: string;
}

export class PostListItemDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Five days in Aswan' })
  title: string;

  @ApiProperty({ description: 'First 200 characters of the content.' })
  excerpt: string;

  @ApiProperty({ type: [String], example: ['egypt'] })
  tags: string[];

  @ApiProperty({ type: AuthorRefDto })
  author: AuthorRefDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'URL of the first image.',
  })
  coverImage: string | null;

  @ApiProperty({ example: 3 })
  likeCount: number;

  @ApiProperty({ example: 2 })
  commentCount: number;

  @ApiProperty({ type: Date, nullable: true })
  publishedAt: Date | null;
}

/** BLG-03: the author's own list also shows status and dates. */
export class MyPostListItemDto extends PostListItemDto {
  @ApiProperty({ enum: POST_STATUSES })
  status: PostStatus;

  @ApiProperty({ description: 'Hidden by an administrator (GEN-10).' })
  isHidden: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PostDetailDto extends PostListItemDto {
  @ApiProperty()
  content: string;

  @ApiProperty({ type: [PostImageDto] })
  images: PostImageDto[];

  @ApiPropertyOptional({
    enum: POST_STATUSES,
    description: 'Shown only to the author and admins.',
  })
  status?: PostStatus;

  @ApiPropertyOptional({ description: 'Shown only to the author and admins.' })
  isHidden?: boolean;

  @ApiProperty({
    type: AttachedItineraryDto,
    nullable: true,
    description:
      'BLG-13 (bonus): the attached itinerary (GET /api/itineraries/:id for the full view). null when none is attached, or when you may not see it (private, hidden or deleted); the author always sees their own.',
  })
  itinerary: AttachedItineraryDto | null;

  @ApiProperty({ description: 'Always false for guests.' })
  likedByMe: boolean;

  @ApiProperty()
  isOwner: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PaginatedPostsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [PostListItemDto] })
  items: PostListItemDto[];
}

export class PaginatedMyPostsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [MyPostListItemDto] })
  items: MyPostListItemDto[];
}

export class DeletedDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: true })
  deleted: true;
}
