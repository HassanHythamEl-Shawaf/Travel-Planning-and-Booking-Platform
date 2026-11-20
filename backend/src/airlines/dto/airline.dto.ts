import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateAirlineDto {
  @ApiProperty({ example: 'Cairo Air', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    example: 'CA',
    minLength: 2,
    maxLength: 3,
    description: 'Unique IATA-style airline code',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 3)
  @Matches(/^[A-Z0-9]+$/)
  code: string;

  @ApiPropertyOptional({
    description:
      'Reserved for the shared image-upload integration; direct URLs are not accepted.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}

export class UpdateAirlineDto {
  @ApiPropertyOptional({ example: 'Cairo Air', minLength: 2, maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({ example: 'CA', minLength: 2, maxLength: 3 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 3)
  @Matches(/^[A-Z0-9]+$/)
  code?: string;

  @ApiPropertyOptional({
    description:
      'Reserved for the shared image-upload integration; direct URLs are not accepted.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string;
}

export class AirlineResponseDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60718' })
  id: string;

  @ApiProperty({ example: 'Cairo Air' })
  name: string;

  @ApiProperty({ example: 'CA' })
  code: string;

  @ApiProperty({ nullable: true, example: null })
  logoUrl: string | null;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
