import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsDateString, IsNumber, Min } from 'class-validator';

import { HotelBookingStatus } from '../hotel-booking-status';

export class ListHotelReservationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page = 1;

  @IsOptional()
  @IsEnum(HotelBookingStatus)
  status?: HotelBookingStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
