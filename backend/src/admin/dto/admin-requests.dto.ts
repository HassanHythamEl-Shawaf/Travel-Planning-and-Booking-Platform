import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

import type { ProviderType } from '../../auth/decorators/provider-ownership.decorator';
import {
  DateRangePageQueryDto,
  PageQueryDto,
} from '../../common/dto/page-query.dto';
import {
  BOOKING_STATUS,
  type BookingStatus,
  type BookingType,
} from '../../integrations/teammate-contracts';
import { PROVIDER_TYPES } from '../../moderator-assignments/schemas/moderator-assignment.schema';
import { AccountStatus, UserRole } from '../../users/schemas/user.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Admin-set temporary password (D9): deliberately NOT subject to the password
 * rules, because the account must replace it at first login anyway.
 */
const TEMPORARY_PASSWORD = {
  example: 'Temp-2026',
  minLength: 1,
  maxLength: 128,
  description:
    'Temporary password chosen by the admin. Not subject to the password rules; the account must change it at next login. Never returned or logged.',
} as const;

export class CreateModeratorDto {
  @ApiProperty({ example: 'Nour Hassan', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({ example: 'nour.moderator@example.com' })
  @Transform(trimLower)
  @IsEmail()
  email: string;

  @ApiProperty(TEMPORARY_PASSWORD)
  @IsString()
  @Length(1, 128)
  temporaryPassword: string;

  @ApiProperty({ enum: PROVIDER_TYPES, example: 'airline' })
  @IsIn(PROVIDER_TYPES)
  providerType: ProviderType;

  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  @IsMongoId()
  providerId: string;
}

export class ListAccountsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'nour',
    maxLength: 100,
    description: 'Case-insensitive literal match on name or email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: AccountStatus })
  @IsOptional()
  @IsEnum(AccountStatus)
  status?: AccountStatus;
}

export class AccountStatusChangeDto {
  @ApiPropertyOptional({
    example: 'Repeated spam in comments',
    maxLength: 500,
    description: 'Shown to the account in its notification',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminResetPasswordDto {
  @ApiProperty(TEMPORARY_PASSWORD)
  @IsString()
  @Length(1, 128)
  temporaryPassword: string;
}

const BOOKING_TYPES: readonly BookingType[] = ['flight', 'hotel'];
const BOOKING_STATUSES = Object.values(BOOKING_STATUS);

export class ListBookingsQueryDto extends DateRangePageQueryDto {
  @ApiPropertyOptional({ enum: BOOKING_TYPES })
  @IsOptional()
  @IsIn(BOOKING_TYPES)
  type?: BookingType;

  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
}
