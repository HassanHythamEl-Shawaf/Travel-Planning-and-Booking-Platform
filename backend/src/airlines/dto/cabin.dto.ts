import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

import { CabinCategory } from '../schemas/flight.schema';

export class CreateCabinDto {
  @ApiProperty({ enum: CabinCategory, example: CabinCategory.ECONOMY })
  @IsEnum(CabinCategory)
  category: CabinCategory;

  @ApiProperty({ example: 120, minimum: 1 })
  @IsInt()
  @Min(1)
  seatCount: number;

  @ApiProperty({ example: 250, exclusiveMinimum: 0 })
  @IsNumber()
  @Min(0.01)
  price: number;

  @ApiProperty({ example: 1, minimum: 0 })
  @IsInt()
  @Min(0)
  freeBaggageAllowance: number;

  @ApiProperty({ example: 23, minimum: 0 })
  @IsNumber()
  @Min(0)
  maxWeightPerBagKg: number;
}

export class UpdateCabinDto {
  @ApiPropertyOptional({ example: 120, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  seatCount?: number;

  @ApiPropertyOptional({ example: 250, exclusiveMinimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  price?: number;

  @ApiPropertyOptional({ example: 1, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  freeBaggageAllowance?: number;

  @ApiPropertyOptional({ example: 23, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeightPerBagKg?: number;
}

export class CabinResponseDto extends CreateCabinDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60720' })
  id: string;
}
