import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { HotelsService } from './hotels.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';

@Controller('api/hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  async create(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelsService.createHotel(createHotelDto);
  }

  @Get()
  async findAll() {
    return this.hotelsService.findAllHotels();
  }

  // --- NEW ROOM ENDPOINTS ---

  @Post('rooms')
  async createRoom(@Body() createRoomDto: CreateRoomDto) {
    return this.hotelsService.createRoom(createRoomDto);
  }

  @Get(':hotelId/rooms')
  async findRoomsByHotel(@Param('hotelId') hotelId: string) {
    return this.hotelsService.findRoomsByHotel(hotelId);
  }
}