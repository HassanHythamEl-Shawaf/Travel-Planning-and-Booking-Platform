import {
  BadRequestException,
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
  NotFoundException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
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
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { SearchHotelsDto } from './dto/search-hotels.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import {
  CreateRoomAvailabilityDto,
  RoomDateRangeDto,
  UpdateRoomAvailabilityDto,
} from './dto/room-date-range.dto';

@ApiTags('Hotels')
@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Create a hotel (HTL-01)' })
  @ApiCreatedResponse({ description: 'The created hotel' })
  @ApiBadRequestResponse({ description: 'Invalid hotel details' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  async create(@Body() createHotelDto: CreateHotelDto) {
    return this.hotelsService.createHotel(createHotelDto);
  }

  @Get()
  @ApiOperation({ summary: 'List active hotels' })
  @ApiOkResponse({ description: 'Active hotels' })
  async findAll() {
    return this.hotelsService.findAllHotels();
  }

  @Get('search')
  @ApiOperation({
    summary: 'Search available hotels (HTL-11, HTL-12)',
    description:
      'Filters by city/country, stay dates, guest and room counts, price, and average rating. Results are paginated with at most 10 per page.',
  })
  @ApiOkResponse({ description: 'Matching hotels and qualifying available rooms' })
  @ApiBadRequestResponse({ description: 'Invalid stay, guest, room, or price criteria' })
  async search(@Query() searchHotelsDto: SearchHotelsDto) {
    return this.hotelsService.searchHotels(searchHotelsDto);
  }

  @Post(':hotelId/rooms')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Add a room to an assigned hotel (HTL-03)' })
  @ApiCreatedResponse({ description: 'The created room' })
  @ApiBadRequestResponse({ description: 'Invalid room details' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  async createRoom(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Body() createRoomDto: CreateRoomDto,
  ) {
    if (createRoomDto.hotelId && createRoomDto.hotelId !== hotelId) {
      throw new BadRequestException('hotelId must match the route');
    }
    return this.hotelsService.createRoom(hotelId, createRoomDto);
  }

  @Patch(':hotelId/rooms/:roomId')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit a room in an assigned hotel (HTL-05)' })
  @ApiOkResponse({ description: 'The updated room' })
  @ApiBadRequestResponse({ description: 'Invalid room details' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  async updateRoom(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() updateRoomDto: UpdateRoomDto,
  ) {
    return this.hotelsService.updateRoom(hotelId, roomId, updateRoomDto);
  }

  @Delete(':hotelId/rooms/:roomId')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Delete a never-booked room (HTL-06)' })
  @ApiOkResponse({ description: 'Room deleted' })
  @ApiConflictResponse({ description: 'Room has an existing reservation' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Room not found in this hotel' })
  async deleteRoom(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
  ) {
    return this.hotelsService.deleteRoom(hotelId, roomId);
  }

  @Get(':hotelId/rooms/available')
  @ApiOperation({ summary: 'List rooms available for a stay (HTL-15)' })
  @ApiQuery({ name: 'checkIn', required: true, type: String, example: '2026-12-20' })
  @ApiQuery({ name: 'checkOut', required: true, type: String, example: '2026-12-23' })
  @ApiOkResponse({ description: 'Available rooms and total stay prices' })
  @ApiBadRequestResponse({ description: 'Invalid dates or check-in is in the past' })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  async availableRooms(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Query() query: RoomDateRangeDto,
  ) {
    return this.hotelsService.findAvailableRooms(
      hotelId,
      query.checkIn,
      query.checkOut,
    );
  }

  @Post(':hotelId/rooms/:roomId/availability')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Add a non-overlapping room availability/block range (HTL-04, HTL-06)' })
  @ApiCreatedResponse({ description: 'The availability or blocked range' })
  @ApiConflictResponse({ description: 'The date range overlaps an existing range or booking' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  async addAvailability(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Body() dto: CreateRoomAvailabilityDto,
  ) {
    return this.hotelsService.addRoomAvailability(hotelId, roomId, dto);
  }

  @Patch(':hotelId/rooms/:roomId/availability/:availabilityId')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit a room availability/block range (HTL-05, HTL-06)' })
  @ApiOkResponse({ description: 'The updated range' })
  @ApiConflictResponse({ description: 'The range overlaps an existing range or booking' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  async updateAvailability(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Param('availabilityId', ParseObjectIdPipe) availabilityId: string,
    @Body() dto: UpdateRoomAvailabilityDto,
  ) {
    return this.hotelsService.updateRoomAvailability(
      hotelId,
      roomId,
      availabilityId,
      dto,
    );
  }

  @Get(':hotelId/availability')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'hotelId')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'View room statuses for a date range (HTL-08)' })
  @ApiQuery({ name: 'checkIn', required: true, type: String })
  @ApiQuery({ name: 'checkOut', required: true, type: String })
  @ApiOkResponse({ description: 'Rooms marked Available, Booked, or Blocked' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  async availability(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Query() query: RoomDateRangeDto,
  ) {
    return this.hotelsService.getAvailability(
      hotelId,
      query.checkIn,
      query.checkOut,
    );
  }

  @Get(':hotelId/rooms/:roomId/availability')
  @ApiOperation({ summary: 'Check one room for a date range' })
  @ApiQuery({ name: 'startDate', required: true, type: String })
  @ApiQuery({ name: 'endDate', required: true, type: String })
  @ApiOkResponse({ description: 'Room availability' })
  @ApiBadRequestResponse({ description: 'Invalid date range' })
  @ApiNotFoundResponse({ description: 'Room not found' })
  async checkRoomAvailability(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
    @Param('roomId', ParseObjectIdPipe) roomId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    if (!(await this.hotelsService.roomBelongsToHotel(hotelId, roomId))) {
      throw new NotFoundException('Room not found in this hotel');
    }
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

  @Get(':hotelId/rooms')
  @ApiOperation({ summary: 'List rooms at an active hotel' })
  @ApiOkResponse({ description: 'Hotel rooms' })
  async findRoomsByHotel(
    @Param('hotelId', ParseObjectIdPipe) hotelId: string,
  ) {
    return this.hotelsService.findRoomsByHotel(hotelId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get hotel details (HTL-02)' })
  @ApiOkResponse({ description: 'Hotel details including policies and photos' })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.hotelsService.findHotelById(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit an assigned hotel profile (HTL-01)' })
  @ApiOkResponse({ description: 'Updated hotel profile' })
  @ApiBadRequestResponse({ description: 'Invalid hotel profile' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  async updateHotel(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateHotelDto,
  ) {
    return this.hotelsService.updateHotel(id, dto);
  }

  @Put(':id/policies')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('hotel', 'id')
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Set hotel policies (HTL-09, HTL-10)' })
  @ApiOkResponse({ description: 'Updated hotel policies' })
  @ApiBadRequestResponse({ description: 'Invalid policy values' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned hotel moderator required' })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  async updatePolicies(
    @Param('id', ParseObjectIdPipe) id: string,
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