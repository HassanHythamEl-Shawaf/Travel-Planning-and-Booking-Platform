import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Equals, IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';

import { FlightBookingDetailsDto } from './list-flight-bookings.dto';

/** FLT-26 refund preview, shown before the user confirms. */
export class FlightRefundPreviewDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60740' })
  bookingId: string;

  @ApiProperty({ example: 'K7QM2X', nullable: true, type: String })
  bookingReference: string | null;

  @ApiProperty({ example: 400 })
  totalPrice: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({
    example: 12,
    description: 'Whole days before the outbound departure',
  })
  daysBeforeDeparture: number;

  @ApiProperty({
    example: 50,
    description: "From the airline's cancellation tiers (FLT-09)",
  })
  refundPercentage: number;

  @ApiProperty({ example: 200 })
  refundAmount: number;
}

export class CancelFlightBookingDto {
  @ApiProperty({
    example: true,
    description:
      'Must be true: the user confirmed after seeing the refund (GEN-03)',
  })
  @IsBoolean()
  @Equals(true, { message: 'confirm must be true to cancel the booking' })
  confirm: boolean;

  @ApiPropertyOptional({
    example: 200,
    description:
      'The refundAmount the user was shown. If the refund has changed since (for example the day changed), the cancellation is refused so the user can review it again.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedRefundAmount?: number;
}

export class FlightCancellationRefundDto {
  @ApiProperty({ example: 50 })
  refundPercentage: number;

  @ApiProperty({ example: 200 })
  refundAmount: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  refundId: string | null;

  @ApiProperty({
    example: 'Pending',
    nullable: true,
    type: String,
    description:
      'Pending, Refunded or Failed (PAY-03); null when no refund was issued',
  })
  status: string | null;
}

export class FlightCancellationResultDto {
  @ApiProperty({ type: FlightBookingDetailsDto })
  booking: FlightBookingDetailsDto;

  @ApiProperty({ type: FlightCancellationRefundDto })
  refund: FlightCancellationRefundDto;
}
