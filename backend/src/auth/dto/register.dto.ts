import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  Equals,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'Hassan Ahmed',
    description: 'Full name of the user',
  })
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;

  @ApiProperty({
    example: 'hassan@example.com',
    description: 'A valid email address',
  })
  @IsEmail()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  email: string;

  @ApiProperty({
    example: 'Password123',
    description: 'At least 8 characters, including one letter and one digit',
  })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain at least one letter and one digit',
  })
  password: string;

  @ApiProperty({
    example: true,
    description: 'Must be true to accept the Terms and Conditions',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms and Conditions',
  })
  termsAccepted: boolean;

  @ApiProperty({
    example: true,
    description: 'Must be true to accept the Privacy Policy',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Privacy Policy',
  })
  privacyPolicyAccepted: boolean;
}