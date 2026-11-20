import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';

export class RoomDateRangeDto {
  @IsDateString()
  checkIn: string;

  @IsDateString()
  checkOut: string;
}

export class CreateRoomAvailabilityDto extends RoomDateRangeDto {
  @IsOptional()
  @IsString()
  @Matches(/^(available|maintenance)$/)
  status?: 'available' | 'maintenance';
}

export class UpdateRoomAvailabilityDto {
  @IsOptional()
  @IsDateString()
  checkIn?: string;

  @IsOptional()
  @IsDateString()
  checkOut?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(available|maintenance)$/)
  status?: 'available' | 'maintenance';
}
