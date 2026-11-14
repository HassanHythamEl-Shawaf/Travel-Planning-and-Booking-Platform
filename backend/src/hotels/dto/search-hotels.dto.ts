import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SearchHotelsDto {
  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  adults?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  children?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @IsString()
  amenities?: string;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'rating_desc', 'newest'])
  sortBy?: 'price_asc' | 'price_desc' | 'rating_desc' | 'newest';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number;
}