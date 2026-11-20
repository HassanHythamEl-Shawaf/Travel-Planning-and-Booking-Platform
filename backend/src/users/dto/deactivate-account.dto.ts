import { ApiProperty } from '@nestjs/swagger';
import { Equals } from 'class-validator';

export class DeactivateAccountDto {
  @ApiProperty({
    example: true,
    description: 'Must be true to confirm account deactivation',
  })
  @Equals(true)
  confirm: boolean;
}
