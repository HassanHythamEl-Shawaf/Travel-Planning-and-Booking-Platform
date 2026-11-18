import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_CHILD_AGE } from '../stay-rules';

/** Not from the requirements sheet: a sanity bound against huge payloads. */
export const MAX_ROOMS_PER_BOOKING = 10;
const MAX_GUESTS_PER_TYPE = 20;

export class RoomGuestsDto {
  @ApiProperty({ example: '665f1c2e9b1e8a0012a4b7c1' })
  @IsMongoId()
  roomId: string;

  @ApiProperty({ minimum: 0, maximum: MAX_GUESTS_PER_TYPE, example: 2 })
  @IsInt()
  @Min(0)
  @Max(MAX_GUESTS_PER_TYPE)
  adults: number;

  @ApiPropertyOptional({
    type: [Number],
    description: `Age of each child (0-${MAX_CHILD_AGE}); one entry per child`,
    example: [4, 9],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_GUESTS_PER_TYPE)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(MAX_CHILD_AGE, { each: true })
  childrenAges?: number[];
}

export class QuoteHotelBookingDto {
  @ApiProperty({ example: '665f1c2e9b1e8a0012a4b7aa' })
  @IsMongoId()
  hotelId: string;

  @ApiProperty({ example: '2026-12-20', description: 'Check-in date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'checkIn must be YYYY-MM-DD' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-23', description: 'Check-out date' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'checkOut must be YYYY-MM-DD' })
  checkOut: string;

  @ApiProperty({ type: [RoomGuestsDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROOMS_PER_BOOKING)
  @ValidateNested({ each: true })
  @Type(() => RoomGuestsDto)
  rooms: RoomGuestsDto[];
}
