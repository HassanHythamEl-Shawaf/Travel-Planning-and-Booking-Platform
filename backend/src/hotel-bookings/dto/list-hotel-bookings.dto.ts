import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional } from 'class-validator';

import { HotelBookingGroup } from '../hotel-booking-group';

export class ListHotelBookingsQueryDto {
  @ApiPropertyOptional({
    enum: HotelBookingGroup,
    default: HotelBookingGroup.UPCOMING,
    description:
      'Upcoming: Confirmed and not yet checked out, or Pending Payment with a running hold. Past: Completed, or Confirmed after check-out. Cancelled: Cancelled or Expired.',
  })
  @IsOptional()
  @IsEnum(HotelBookingGroup)
  group: HotelBookingGroup = HotelBookingGroup.UPCOMING;

  @ApiPropertyOptional({
    example: 1,
    description: 'Page number, 10 per page; validated by getPagination',
  })
  @IsOptional()
  @Type(() => Number)
  page?: number;
}