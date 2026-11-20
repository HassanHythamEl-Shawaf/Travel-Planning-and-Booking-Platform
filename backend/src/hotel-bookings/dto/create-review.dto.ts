import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { MAX_COMMENT_LENGTH, MAX_RATING, MIN_RATING } from '../review-rules';

export class CreateReviewDto {
  @ApiProperty({ minimum: MIN_RATING, maximum: MAX_RATING, example: 4 })
  @IsInt()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating: number;

  @ApiPropertyOptional({
    maxLength: MAX_COMMENT_LENGTH,
    example: 'Clean rooms and friendly staff.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_COMMENT_LENGTH)
  comment?: string;
}