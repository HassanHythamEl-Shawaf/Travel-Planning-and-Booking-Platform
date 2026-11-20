import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';

export class ListReviewsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Page number, 10 per page; validated by getPagination',
  })
  @IsOptional()
  @Type(() => Number)
  page?: number;
}