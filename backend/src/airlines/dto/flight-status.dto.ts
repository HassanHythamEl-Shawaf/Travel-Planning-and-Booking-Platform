import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus } from '../schemas/flight.schema';

export class FlightStatusResponseDto {
  @ApiProperty({ enum: FlightStatus, example: FlightStatus.SCHEDULED })
  status: FlightStatus;
}
