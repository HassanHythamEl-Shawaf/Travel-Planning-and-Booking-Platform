import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateBaggagePolicyDto {
  @ApiProperty({ example: 35, minimum: 0.01 })
  @IsNumber()
  @Min(0.01)
  pricePerExtraBag: number;

  @ApiProperty({ example: 2, minimum: 0 })
  @IsInt()
  @Min(0)
  maxExtraBagsPerPassenger: number;
}

export class BaggagePolicyResponseDto {
  @ApiProperty({ example: 35 })
  pricePerExtraBag: number;

  @ApiProperty({ example: 2 })
  maxExtraBagsPerPassenger: number;
}
