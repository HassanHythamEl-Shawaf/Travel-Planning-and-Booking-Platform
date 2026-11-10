import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';
import { FlightResponseDto } from './flight.dto';

export class UpdateFlightScheduleDto {
  @ApiProperty({
    example: '2027-01-01T10:30:00',
    description: 'Local departure time at the existing departure airport.',
  })
  @IsISO8601({ strict: true })
  departureLocalTime: string;

  @ApiProperty({
    example: '2027-01-01T14:00:00',
    description: 'Local arrival time at the existing arrival airport.',
  })
  @IsISO8601({ strict: true })
  arrivalLocalTime: string;
}

export class FlightUpdateResponseDto extends FlightResponseDto {}
