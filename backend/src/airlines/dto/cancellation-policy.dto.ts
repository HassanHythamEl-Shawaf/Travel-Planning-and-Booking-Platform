import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsNotEmpty,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CancellationTierDto {
  @ApiProperty({ example: 30, minimum: 0 })
  @IsInt()
  @Min(0)
  daysBeforeDeparture: number;

  @ApiProperty({ example: 75, minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercentage: number;
}

export class UpdateCancellationPolicyDto {
  @ApiProperty({ type: [CancellationTierDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  @IsNotEmpty()
  tiers: CancellationTierDto[];
}

export class CancellationPolicyResponseDto {
  @ApiProperty({ type: [CancellationTierDto] })
  tiers: CancellationTierDto[];
}
