import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { COUNTRY_CODE_REGEX } from '../reference-data.constants';

export class ListCitiesQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 'AE',
    description: 'ISO 3166-1 alpha-2 country code (uppercase)',
  })
  @IsOptional()
  @Matches(COUNTRY_CODE_REGEX, {
    message: 'countryCode must be two uppercase letters',
  })
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'cai',
    description: 'Case-insensitive match on city name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
