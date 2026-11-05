import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { COMMENT_MAX } from '../blog.constants';
import { AuthorRefDto, trim } from './post.dto';

const ID = '6650f1c2a1b2c3d4e5f60718';

export class CommentBodyDto {
  @ApiProperty({
    example: 'The felucca at sunset was the best part!',
    maxLength: COMMENT_MAX,
    description: `Trimmed, 1–${COMMENT_MAX} characters (BLG-05).`,
  })
  @Transform(trim)
  @IsString()
  @Length(1, COMMENT_MAX)
  content: string;
}

export class CommentDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty()
  content: string;

  @ApiProperty({
    type: AuthorRefDto,
    description: 'id null and name "Deleted user" when the author deactivated their account.',
  })
  author: AuthorRefDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  editedAt: Date | null;

  @ApiProperty()
  isOwner: boolean;

  @ApiPropertyOptional({
    description: 'Shown only to the comment author and admins.',
  })
  isHidden?: boolean;
}

export class PaginatedCommentsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [CommentDto] })
  items: CommentDto[];
}

export class LikeStateDto {
  @ApiProperty({ example: true })
  liked: boolean;

  @ApiProperty({ example: 4 })
  likeCount: number;
}
