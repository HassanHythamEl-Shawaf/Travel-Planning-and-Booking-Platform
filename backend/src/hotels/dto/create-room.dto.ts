import {
  IsArray,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class OccupancyDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  maxAdults: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  maxChildren: number;
}

export class CreateRoomDto {
  @IsOptional()
  @IsMongoId()
  hotelId?: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  pricePerNight: number;

  @IsNotEmpty()
  @IsString()
  type: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  beds: number;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => OccupancyDto)
  occupancy: OccupancyDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}