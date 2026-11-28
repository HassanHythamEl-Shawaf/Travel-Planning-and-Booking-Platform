import { ApiProperty } from '@nestjs/swagger';
import { AirlineResponseDto } from './airline.dto';
import { BaggagePolicyResponseDto } from './baggage-policy.dto';
import { CabinResponseDto } from './cabin.dto';
import { CancellationTierDto } from './cancellation-policy.dto';
import { FlightResponseDto } from './flight.dto';

export class ManagedFlightDto extends FlightResponseDto {
  @ApiProperty({ type: [CabinResponseDto] })
  cabins: CabinResponseDto[];
}

export class AirlineWorkspaceDto {
  @ApiProperty({ type: AirlineResponseDto })
  airline: AirlineResponseDto;

  @ApiProperty({ type: BaggagePolicyResponseDto, nullable: true })
  baggagePolicy: BaggagePolicyResponseDto | null;

  @ApiProperty({ type: [CancellationTierDto] })
  cancellationPolicy: CancellationTierDto[];

  @ApiProperty({ type: [ManagedFlightDto] })
  flights: ManagedFlightDto[];

  @ApiProperty()
  page: number;

  @ApiProperty()
  totalPages: number;
}
