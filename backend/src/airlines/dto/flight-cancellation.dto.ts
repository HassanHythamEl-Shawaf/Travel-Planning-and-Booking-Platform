import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class CancelFlightDto {
  @ApiProperty({ example: true, description: 'Must be true to confirm cancellation.' })
  @IsBoolean()
  confirm: boolean;
}

export class FlightCancellationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: 'Cancelled' })
  status: string;
}
