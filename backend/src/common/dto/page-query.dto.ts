import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class PageQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}

/** Page plus an inclusive ISO 8601 `from` / `to` range on createdAt. */
export class DateRangePageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'ISO 8601 date or timestamp (inclusive) on createdAt',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30T23:59:59Z',
    description: 'ISO 8601 date or timestamp (inclusive) on createdAt',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export function toDate(value?: string): Date | undefined {
  return value ? new Date(value) : undefined;
}
