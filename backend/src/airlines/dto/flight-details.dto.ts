import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus } from '../schemas/flight.schema';

export class FlightDetailsCabinDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  category: string;

  @ApiProperty()
  price: number;

  @ApiProperty()
  seatsRemaining: number;

  @ApiProperty()
  freeBaggageAllowance: number;

  @ApiProperty()
  maxWeightPerBagKg: number;
}

export class FlightDetailsPolicyTierDto {
  @ApiProperty()
  daysBeforeDeparture: number;

  @ApiProperty()
  refundPercentage: number;
}

export class FlightDetailsResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  airlineId: string;

  @ApiProperty()
  airlineName: string;

  @ApiProperty()
  airlineCode: string;

  @ApiProperty()
  flightNumber: string;

  @ApiProperty()
  departureAirportCode: string;

  @ApiProperty()
  arrivalAirportCode: string;

  @ApiProperty({ example: '2026-12-01T10:30:00' })
  departureLocalTime: string;

  @ApiProperty({ example: '2026-12-01T14:00:00' })
  arrivalLocalTime: string;

  @ApiProperty()
  departureTimeZone: string;

  @ApiProperty()
  arrivalTimeZone: string;

  @ApiProperty()
  durationMinutes: number;

  @ApiProperty({ enum: FlightStatus })
  status: FlightStatus;

  @ApiProperty({ type: [FlightDetailsCabinDto] })
  cabins: FlightDetailsCabinDto[];

  @ApiProperty({ type: [FlightDetailsPolicyTierDto] })
  cancellationPolicy: FlightDetailsPolicyTierDto[];
}
