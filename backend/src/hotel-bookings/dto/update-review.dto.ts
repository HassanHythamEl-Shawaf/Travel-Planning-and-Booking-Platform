import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { MAX_COMMENT_LENGTH, MAX_RATING, MIN_RATING } from '../review-rules';

export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: MIN_RATING, maximum: MAX_RATING, example: 5 })
  @IsOptional()
  @IsInt()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating?: number;

  @ApiPropertyOptional({
    maxLength: MAX_COMMENT_LENGTH,
    description: 'An empty string removes the comment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMMENT_LENGTH)
  comment?: string;
}