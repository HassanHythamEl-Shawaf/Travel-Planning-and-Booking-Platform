import { IsString, IsNotEmpty, IsNumber, IsOptional, IsArray, ValidateNested, IsMongoId } from 'class-validator';
import { Type } from 'class-transformer';

class OccupancyDto {
  @IsNotEmpty()
  @IsNumber()
  maxAdults: number;

  @IsNotEmpty()
  @IsNumber()
  maxChildren: number;
}

export class CreateRoomDto {
  @IsNotEmpty()
  @IsMongoId()
  hotelId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsNumber()
  pricePerNight: number;

  @IsNotEmpty()
  @ValidateNested()
  @Type(() => OccupancyDto)
  occupancy: OccupancyDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  amenities?: string[];
}