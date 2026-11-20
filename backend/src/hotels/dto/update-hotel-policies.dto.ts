import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CancellationPolicyDto {
  @IsNumber()
  @Min(0)
  freeCancellationHours: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  refundPercentageAfterDeadline: number;

  @IsString()
  description: string;
}

export class UpdateHotelPoliciesDto {
  @IsOptional()
  @IsString()
  checkInTime?: string;

  @IsOptional()
  @IsString()
  checkOutTime?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CancellationPolicyDto)
  cancellationPolicy?: CancellationPolicyDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  houseRules?: string[];
}