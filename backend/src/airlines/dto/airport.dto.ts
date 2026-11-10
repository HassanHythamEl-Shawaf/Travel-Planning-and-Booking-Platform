import { ApiProperty } from '@nestjs/swagger';

export class AirportResponseDto {
  @ApiProperty({ example: 'CAI' })
  iataCode: string;

  @ApiProperty({ example: 'Cairo International Airport' })
  name: string;

  @ApiProperty({ example: 'Cairo' })
  city: string;

  @ApiProperty({ example: 'Egypt' })
  country: string;

  @ApiProperty({ example: 'Africa/Cairo' })
  timeZone: string;
}
