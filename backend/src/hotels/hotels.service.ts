import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room, RoomDocument } from './schemas/room.schema';
import {
  RoomAvailability,
  RoomAvailabilityDocument,
} from './schemas/room-availability.schema';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { BlockRoomDto } from './dto/block-room.dto';
import { UpdateHotelPoliciesDto } from './dto/update-hotel-policies.dto';
import { SearchHotelsDto } from './dto/search-hotels.dto';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    private roomAvailabilityModel: Model<RoomAvailabilityDocument>,
  ) {}

  async createHotel(createHotelDto: CreateHotelDto): Promise<Hotel> {
    const createdHotel = new this.hotelModel(createHotelDto);
    return createdHotel.save();
  }

  async findAllHotels(): Promise<Hotel[]> {
    return this.hotelModel.find({ isActive: { $ne: false } }).exec();
  }

  async searchHotels(searchDto: SearchHotelsDto) {
    const {
      destination,
      startDate,
      endDate,
      amenities,
      sortBy = 'rating_desc',
    } = searchDto;

    const adults = searchDto.adults ? Number(searchDto.adults) : undefined;
    const children =
      searchDto.children !== undefined ? Number(searchDto.children) : undefined;
    const minPrice =
      searchDto.minPrice !== undefined ? Number(searchDto.minPrice) : undefined;
    const maxPrice =
      searchDto.maxPrice !== undefined ? Number(searchDto.maxPrice) : undefined;
    const minRating =
      searchDto.minRating !== undefined
        ? Number(searchDto.minRating)
        : undefined;
    const page = searchDto.page ? Math.max(1, Number(searchDto.page)) : 1;
    const limit = searchDto.limit ? Math.max(1, Number(searchDto.limit)) : 10;

    if ((startDate && !endDate) || (!startDate && endDate)) {
      throw new BadRequestException(
        'Both startDate and endDate must be provided together.',
      );
    }

    let parsedDates: { start: Date; end: Date } | null = null;
    if (startDate && endDate) {
      parsedDates = this.parseAndValidateDates(startDate, endDate);
    }

    // 1. Filter active hotels by destination and minimum rating
    const hotelFilter: Record<string, any> = { isActive: { $ne: false } };

    if (destination && destination.trim()) {
      const escaped = destination.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      hotelFilter.$or = [{ city: regex }, { country: regex }, { name: regex }];
    }

    if (minRating !== undefined && !isNaN(minRating)) {
      hotelFilter.averageRating = { $gte: minRating };
    }

    const hotels = await this.hotelModel.find(hotelFilter).lean().exec();
    if (hotels.length === 0) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    const hotelIdStrings = hotels.map((h) => String(h._id));

    // 2. Find unavailable room IDs if dates are provided
    const unavailableRoomIds = new Set<string>();
    if (parsedDates) {
      const conflicts = await this.roomAvailabilityModel
        .find({
          startDate: { $lt: parsedDates.end },
          endDate: { $gt: parsedDates.start },
        })
        .select('roomId')
        .lean()
        .exec();

      for (const entry of conflicts) {
        unavailableRoomIds.add(String(entry.roomId));
      }
    }

    // 3. Query active rooms matching guest count, price, and amenities
    const roomFilter: Record<string, any> = {
      isActive: { $ne: false },
      $expr: { $in: [{ $toString: '$hotelId' }, hotelIdStrings] },
    };

    if (adults !== undefined && !isNaN(adults)) {
      roomFilter['occupancy.maxAdults'] = { $gte: adults };
    }

    if (children !== undefined && !isNaN(children)) {
      roomFilter['occupancy.maxChildren'] = { $gte: children };
    }

    if (
      (minPrice !== undefined && !isNaN(minPrice)) ||
      (maxPrice !== undefined && !isNaN(maxPrice))
    ) {
      roomFilter.pricePerNight = {};
      if (minPrice !== undefined && !isNaN(minPrice)) {
        roomFilter.pricePerNight.$gte = minPrice;
      }
      if (maxPrice !== undefined && !isNaN(maxPrice)) {
        roomFilter.pricePerNight.$lte = maxPrice;
      }
    }

    if (amenities && amenities.trim()) {
      const amenityList = amenities
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      if (amenityList.length > 0) {
        roomFilter.amenities = { $all: amenityList };
      }
    }

    const matchingRooms = await this.roomModel.find(roomFilter).lean().exec();

    // 4. Group available matching rooms by hotel
    const roomsByHotel = new Map<string, any[]>();
    for (const room of matchingRooms) {
      if (unavailableRoomIds.has(String(room._id))) {
        continue;
      }
      const hId = String(room.hotelId);
      const list = roomsByHotel.get(hId) ?? [];
      list.push(room);
      roomsByHotel.set(hId, list);
    }

    // 5. Build result items (only hotels with >= 1 available matching room)
    const results = hotels
      .filter((hotel) => roomsByHotel.has(String(hotel._id)))
      .map((hotel) => {
        const availableRooms = roomsByHotel.get(String(hotel._id))!;
        const startingPrice = Math.min(
          ...availableRooms.map((r) => r.pricePerNight),
        );
        return {
          ...hotel,
          startingPrice,
          availableRoomsCount: availableRooms.length,
          availableRooms,
        };
      });

    // 6. Sort results
    results.sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.startingPrice - b.startingPrice;
        case 'price_desc':
          return b.startingPrice - a.startingPrice;
        case 'newest':
          return (
            new Date((b as any).createdAt ?? 0).getTime() -
            new Date((a as any).createdAt ?? 0).getTime()
          );
        case 'rating_desc':
        default:
          return (b.averageRating ?? 0) - (a.averageRating ?? 0);
      }
    });

    // 7. Paginate
    const total = results.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedData = results.slice(startIndex, startIndex + limit);

    return {
      data: paginatedData,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async findHotelById(hotelId: string): Promise<Hotel> {
    const hotel = await this.hotelModel.findById(hotelId).exec();
    if (!hotel) {
      throw new NotFoundException(`Hotel with ID ${hotelId} not found`);
    }
    return hotel;
  }

  async updateHotelPolicies(
    hotelId: string,
    updateHotelPoliciesDto: UpdateHotelPoliciesDto,
  ): Promise<Hotel> {
    const updatedHotel = await this.hotelModel
      .findByIdAndUpdate(
        hotelId,
        { $set: updateHotelPoliciesDto },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();

    if (!updatedHotel) {
      throw new NotFoundException(`Hotel with ID ${hotelId} not found`);
    }

    return updatedHotel;
  }

  // --- ROOM METHODS ---

  async createRoom(createRoomDto: CreateRoomDto): Promise<Room> {
    const createdRoom = new this.roomModel(createRoomDto);
    return createdRoom.save();
  }

  async findRoomsByHotel(hotelId: string): Promise<Room[]> {
    return this.roomModel.find({ hotelId }).exec();
  }

  async updateRoom(roomId: string, updateRoomDto: UpdateRoomDto): Promise<Room> {
    if (updateRoomDto.isActive === false) {
      const activeReservation = await this.roomAvailabilityModel
        .findOne({
          $expr: { $eq: [{ $toString: '$roomId' }, roomId] },
          status: { $in: ['held', 'booked'] },
          endDate: { $gt: new Date() },
        })
        .exec();

      if (activeReservation) {
        throw new ConflictException(
          'Cannot deactivate room: it overlaps a Confirmed or Pending Payment reservation.',
        );
      }
    }

    const updatedRoom = await this.roomModel
      .findByIdAndUpdate(
        roomId,
        { $set: updateRoomDto },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();

    if (!updatedRoom) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    return updatedRoom;
  }

  async deleteRoom(
    roomId: string,
  ): Promise<{ deleted: boolean; roomId: string }> {
    const room = await this.roomModel.findById(roomId).exec();
    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    const activeReservation = await this.roomAvailabilityModel
      .findOne({
        $expr: { $eq: [{ $toString: '$roomId' }, roomId] },
        status: { $in: ['held', 'booked'] },
        endDate: { $gt: new Date() },
      })
      .exec();

    if (activeReservation) {
      throw new ConflictException(
        'Cannot delete room: it overlaps a Confirmed or Pending Payment reservation.',
      );
    }

    await this.roomModel.findByIdAndDelete(roomId).exec();
    await this.roomAvailabilityModel
      .deleteMany({
        $expr: { $eq: [{ $toString: '$roomId' }, roomId] },
      })
      .exec();

    return { deleted: true, roomId };
  }

  // --- AVAILABILITY & INVENTORY INTERFACE (FOR PERSON 6) ---

  private parseAndValidateDates(
    startDate: Date | string,
    endDate: Date | string,
  ): { start: Date; end: Date } {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      throw new BadRequestException(
        'Invalid date range: startDate must be before endDate.',
      );
    }

    return { start, end };
  }

  async checkAvailability(
    roomId: string,
    startDate: Date | string,
    endDate: Date | string,
  ): Promise<boolean> {
    const { start, end } = this.parseAndValidateDates(startDate, endDate);

    const room = await this.roomModel.findById(roomId).exec();
    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }

    const hotel = await this.hotelModel.findById(room.hotelId).exec();
    if (!hotel || hotel.isActive === false || room.isActive === false) {
      return false;
    }

    const conflict = await this.roomAvailabilityModel
      .findOne({
        $expr: { $eq: [{ $toString: '$roomId' }, roomId] },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .exec();

    return !conflict;
  }

  async reserveDates(
    roomIds: string[],
    startDate: Date | string,
    endDate: Date | string,
    bookingReference: string,
    status: 'held' | 'booked' = 'held',
  ): Promise<RoomAvailability[]> {
    const { start, end } = this.parseAndValidateDates(startDate, endDate);

    if (!roomIds || roomIds.length === 0) {
      throw new BadRequestException('At least one roomId is required.');
    }

    const uniqueRoomIds = [...new Set(roomIds)];

    for (const roomId of uniqueRoomIds) {
      const available = await this.checkAvailability(roomId, start, end);
      if (!available) {
        throw new ConflictException(
          `Room ${roomId} is not available for the selected date range.`,
        );
      }
    }

    const entries = uniqueRoomIds.map((roomId) => ({
      roomId: new Types.ObjectId(roomId),
      startDate: start,
      endDate: end,
      status,
      bookingReference,
    }));

    return this.roomAvailabilityModel.insertMany(entries) as unknown as Promise<
      RoomAvailability[]
    >;
  }

  async confirmDates(bookingReference: string): Promise<void> {
    await this.roomAvailabilityModel
      .updateMany({ bookingReference }, { $set: { status: 'booked' } })
      .exec();
  }

  async releaseDates(bookingReference: string): Promise<void> {
    await this.roomAvailabilityModel.deleteMany({ bookingReference }).exec();
  }

  async blockRoom(
    roomId: string,
    blockRoomDto: BlockRoomDto,
  ): Promise<RoomAvailability> {
    const { start, end } = this.parseAndValidateDates(
      blockRoomDto.startDate,
      blockRoomDto.endDate,
    );

    const overlappingReservation = await this.roomAvailabilityModel
      .findOne({
        $expr: { $eq: [{ $toString: '$roomId' }, roomId] },
        status: { $in: ['held', 'booked'] },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .exec();

    if (overlappingReservation) {
      throw new ConflictException(
        'Cannot block room: date range overlaps an existing hold or booking.',
      );
    }

    const block = new this.roomAvailabilityModel({
      roomId: new Types.ObjectId(roomId),
      startDate: start,
      endDate: end,
      status: blockRoomDto.status ?? 'maintenance',
      bookingReference: blockRoomDto.bookingReference,
    });

    return block.save();
  }
}