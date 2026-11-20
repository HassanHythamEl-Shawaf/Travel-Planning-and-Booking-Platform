import { IsNotEmpty, IsDateString, IsOptional, IsString, IsEnum } from 'class-validator';

export class BlockRoomDto {
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsEnum(['booked', 'maintenance'])
  status?: string;

  @IsOptional()
  @IsString()
  bookingReference?: string;
}