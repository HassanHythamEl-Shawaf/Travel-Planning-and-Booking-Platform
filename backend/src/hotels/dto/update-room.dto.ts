import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

class UpdateOccupancyDto {
  @IsNumber()
  @Min(1)
  maxAdults: number;

  @IsNumber()
  @Min(0)
  maxChildren: number;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerNight?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOccupancyDto)
  occupancy?: UpdateOccupancyDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}