import { ApiProperty } from '@nestjs/swagger';

import { PaginatedPostsDto } from './post.dto';

const ID = '6650f1c2a1b2c3d4e5f60718';

export class PublicItinerarySummaryDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Luxor in a weekend' })
  title: string;

  @ApiProperty({ type: [String], example: ['EG'] })
  countries: string[];

  @ApiProperty({ type: Date, nullable: true })
  createdAt: Date | null;
}

/** BLG-12. The User schema has no bio or avatar yet, so neither is returned. */
export class AuthorPageDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Alice Author' })
  name: string;

  @ApiProperty({ description: 'When the account was created.' })
  joinedAt: Date;

  @ApiProperty({ example: 4 })
  publishedPostCount: number;

  @ApiProperty({
    type: PaginatedPostsDto,
    description: 'Published posts, same order as search; paginated with "page".',
  })
  posts: PaginatedPostsDto;

  @ApiProperty({
    type: [PublicItinerarySummaryDto],
    description: 'Up to 10 public itineraries, newest first.',
  })
  publicItineraries: PublicItinerarySummaryDto[];
}

export class PostImagesDto {
  @ApiProperty({
    type: 'array',
    items: {
      type: 'object',
      properties: { imageId: { type: 'string' }, url: { type: 'string' } },
    },
    description: 'In order; the first image is the cover.',
  })
  images: { imageId: string; url: string }[];
}
