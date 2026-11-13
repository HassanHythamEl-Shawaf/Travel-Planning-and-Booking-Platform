import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { HotelsService } from './hotels.service';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { BlockRoomDto } from './dto/block-room.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { SearchHotelsDto } from './dto/search-hotels.dto';

@Controller('hotels')
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

  @Get('search')
  async search(@Query() searchHotelsDto: SearchHotelsDto) {
    return this.hotelsService.searchHotels(searchHotelsDto);
  }

  // --- ROOM ENDPOINTS ---

  @Post('rooms')
  async createRoom(@Body() createRoomDto: CreateRoomDto) {
    return this.hotelsService.createRoom(createRoomDto);
  }

  @Patch('rooms/:roomId')
  async updateRoom(
    @Param('roomId') roomId: string,
    @Body() updateRoomDto: UpdateRoomDto,
  ) {
    return this.hotelsService.updateRoom(roomId, updateRoomDto);
  }

  @Delete('rooms/:roomId')
  async deleteRoom(@Param('roomId') roomId: string) {
    return this.hotelsService.deleteRoom(roomId);
  }

  @Get('rooms/:roomId/availability')
  async checkRoomAvailability(
    @Param('roomId') roomId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    const isAvailable = await this.hotelsService.checkAvailability(
      roomId,
      startDate,
      endDate,
    );
    return {
      roomId,
      startDate,
      endDate,
      isAvailable,
    };
  }

  @Post('rooms/:roomId/block')
  async blockRoom(
    @Param('roomId') roomId: string,
    @Body() blockRoomDto: BlockRoomDto,
  ) {
    return this.hotelsService.blockRoom(roomId, blockRoomDto);
  }

  @Get(':hotelId/rooms')
  async findRoomsByHotel(@Param('hotelId') hotelId: string) {
    return this.hotelsService.findRoomsByHotel(hotelId);
  }

  // --- HOTEL DETAILS & POLICIES ---

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.hotelsService.findHotelById(id);
  }

  @Put(':id/policies')
  async updatePolicies(
    @Param('id') id: string,
    @Body() updateHotelPoliciesDto: UpdateHotelPoliciesDto,
  ) {
    return this.hotelsService.updateHotelPolicies(id, updateHotelPoliciesDto);
  }
}