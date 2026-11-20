import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsNumber, IsOptional, Min } from 'class-validator';

export class CancelHotelBookingDto {
  @ApiProperty({
    example: true,
    description: 'Must be true: confirms the user saw the refund preview',
  })
  @Equals(true, { message: 'confirm must be true' })
  confirm: boolean;

  @ApiPropertyOptional({
    example: 300,
    description:
      'The refund amount that was shown. If the refund is different now, the cancellation is refused.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedRefundAmount?: number;
}