import { ApiProperty } from '@nestjs/swagger';

export class FlightBookingPassengerDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60720' })
  id: string;

  @ApiProperty({ example: 'Sara Hassan' })
  name: string;
}

export class FlightBookingItemDto {
  @ApiProperty({ example: 'BK-CA101-001' })
  id: string;

  @ApiProperty({ example: 'BK-CA101-001' })
  bookingReference: string;

  @ApiProperty({ type: [FlightBookingPassengerDto] })
  passengers: FlightBookingPassengerDto[];

  @ApiProperty({ example: 'Economy' })
  cabin: string;

  @ApiProperty({ example: 2 })
  seats: number;

  @ApiProperty({ example: 'Confirmed' })
  status: string;

  @ApiProperty({ example: 148 })
  remainingSeats: number;
}

export class FlightBookingsResponseDto {
  @ApiProperty({ example: '6650f1c2a1b2c3d4e5f60719' })
  flightId: string;

  @ApiProperty({ type: [FlightBookingItemDto] })
  items: FlightBookingItemDto[];
}
