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
  HttpCode,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ProviderOwnership } from '../auth/decorators/provider-ownership.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ProviderOwnershipGuard } from '../auth/guards/provider-ownership.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ImageFileInterceptor } from '../uploads/image-file.interceptor';
import { UserRole } from '../users/schemas/user.schema';
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

  // --- HOTEL PHOTOS (HTL-01, GEN-08; added by Person 8) ---

  @Post(':id/photos')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel')
  @UseInterceptors(ImageFileInterceptor('file'))
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Add a photo to the hotel (HTL-01, GEN-08)',
    description:
      'Multipart field "file": JPG or PNG, up to 5 MB, at most 5 photos per hotel. Only the assigned hotel moderator. Returns the hotel\'s photo URLs.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60718' })
  @ApiCreatedResponse({
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'string' } } },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid id, missing file, not a JPG/PNG, over 5 MB, or the hotel already has 5 photos',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  async addPhoto(
    @Param('id', ParseObjectIdPipe) id: string,
    @UploadedFile() file: unknown,
  ) {
    return this.hotelsService.addHotelPhoto(id, file);
  }

  @Delete(':id/photos/:fileName')
  @HttpCode(200)
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Remove a hotel photo (HTL-01, GEN-08)',
    description:
      'fileName is the last part of the photo URL (/api/uploads/<fileName>). Removes it from the hotel and deletes the file. Only the assigned hotel moderator.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60718' })
  @ApiParam({
    name: 'fileName',
    example: '3f1c2a9e-8b4d-4c1e-9f2a-7d6e5b4a3c21.jpg',
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: { photos: { type: 'array', items: { type: 'string' } } },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid hotel id' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Hotel not found, or the photo is not on it' })
  async removePhoto(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('fileName') fileName: string,
  ) {
    return this.hotelsService.removeHotelPhoto(id, fileName);
  }
}