import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  Logger,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { RoomInventoryService } from '../hotel-bookings/room-inventory.service';
import {
  HOTEL_PHOTO_STORE,
  type HotelPhotoStore,
} from '../uploads/adapters/hotel-photo.adapter';
import {
  MAX_IMAGES_PER_ITEM,
  UPLOADS_URL_PREFIX,
} from '../uploads/uploads.constants';
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
import { UpdateHotelDto } from './dto/update-hotel.dto';
import {
  CreateRoomAvailabilityDto,
  UpdateRoomAvailabilityDto,
} from './dto/room-date-range.dto';

/** HTL-01 / GEN-08: at most 5 photos per hotel. */
const MAX_HOTEL_PHOTOS = MAX_IMAGES_PER_ITEM.hotel;

@Injectable()
export class HotelsService {
  private readonly logger = new Logger(HotelsService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Hotel.name) private hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name)
    private roomAvailabilityModel: Model<RoomAvailabilityDocument>,
    private readonly inventory: RoomInventoryService,
    // Person 8's shared upload module (GEN-08), for hotel photos.
    @Optional()
    @Inject(HOTEL_PHOTO_STORE)
    private readonly photoStore?: HotelPhotoStore | null,
  ) {}

  async createHotel(createHotelDto: CreateHotelDto): Promise<Hotel> {
    const createdHotel = new this.hotelModel(createHotelDto);
    return createdHotel.save();
  }

  async updateHotel(
    hotelId: string,
    dto: UpdateHotelDto,
  ): Promise<Hotel> {
    const updated = await this.hotelModel
      .findByIdAndUpdate(
        hotelId,
        { $set: dto },
        { returnDocument: 'after', runValidators: true },
      )
      .exec();
    if (!updated) throw new NotFoundException('Hotel not found');
    return updated;
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

    const guests =
      searchDto.guests ??
      (Number(searchDto.adults ?? 1) + Number(searchDto.children ?? 0));
    const roomsRequired = Number(searchDto.rooms ?? 1);
    const minPrice = searchDto.minPrice;
    const maxPrice = searchDto.maxPrice;
    const minRating = searchDto.minRating;
    const page = Number(searchDto.page ?? 1);
    const limit = Math.min(Number(searchDto.limit ?? 10), 10);
    if (roomsRequired > guests) {
      throw new BadRequestException('rooms cannot be more than guests');
    }
    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      minPrice > maxPrice
    ) {
      throw new BadRequestException('minPrice cannot exceed maxPrice');
    }

    if ((startDate && !endDate) || (!startDate && endDate)) {
      throw new BadRequestException(
        'Both startDate and endDate must be provided together.',
      );
    }

    let parsedDates: { start: Date; end: Date } | null = null;
    if (startDate && endDate) {
      parsedDates = this.parseAndValidateDates(startDate, endDate);
    }

    const hotelFilter: Record<string, unknown> = {
      isActive: { $ne: false },
    };

    if (destination && destination.trim()) {
      const escaped = destination.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      hotelFilter.$or = [{ city: regex }, { country: regex }, { name: regex }];
    }

    if (minRating !== undefined) {
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
    const roomFilter: Record<string, unknown> = {
      isActive: { $ne: false },
      $expr: { $in: [{ $toString: '$hotelId' }, hotelIdStrings] },
    };

    if (
      minPrice !== undefined ||
      maxPrice !== undefined
    ) {
      roomFilter.pricePerNight = {
        ...(minPrice !== undefined ? { $gte: minPrice } : {}),
        ...(maxPrice !== undefined ? { $lte: maxPrice } : {}),
      };
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
    const availabilityRows =
      parsedDates && matchingRooms.length > 0
        ? await this.roomAvailabilityModel
            .find({
              roomId: { $in: matchingRooms.map((room) => room._id) },
              startDate: { $lt: parsedDates.end },
              endDate: { $gt: parsedDates.start },
              $or: [
                { status: { $in: ['booked', 'maintenance'] } },
                { status: 'held', holdExpiresAt: { $gt: new Date() } },
                { status: 'held', holdExpiresAt: null },
                { status: 'held', holdExpiresAt: { $exists: false } },
              ],
            })
            .select('roomId status')
            .lean()
            .exec()
        : [];
    const unavailableRoomIds = new Set(
      availabilityRows.map((entry) => String(entry.roomId)),
    );
    const windowsByRoom = new Map<string, Array<{ startDate: Date; endDate: Date }>>();
    if (parsedDates && matchingRooms.length > 0) {
      const windows = await this.roomAvailabilityModel
        .find({
          roomId: { $in: matchingRooms.map((room) => room._id) },
          status: 'available',
        })
        .select('roomId startDate endDate')
        .lean()
        .exec();
      for (const window of windows) {
        const key = String(window.roomId);
        const list = windowsByRoom.get(key) ?? [];
        list.push({
          startDate: window.startDate,
          endDate: window.endDate,
        });
        windowsByRoom.set(key, list);
      }
    }

    const roomsByHotel = new Map<string, any[]>();
    for (const room of matchingRooms) {
      const roomId = String(room._id);
      if (unavailableRoomIds.has(roomId)) continue;
      if (
        parsedDates &&
        windowsByRoom.has(roomId) &&
        !coversDateRange(
          windowsByRoom.get(roomId) ?? [],
          parsedDates.start,
          parsedDates.end,
        )
      ) continue;
      const hId = String(room.hotelId);
      const list = roomsByHotel.get(hId) ?? [];
      list.push(room);
      roomsByHotel.set(hId, list);
    }

    const results = hotels.flatMap((hotel) => {
      const availableRooms = roomsByHotel.get(String(hotel._id)) ?? [];
      const qualifyingRooms = chooseRooms(availableRooms, roomsRequired, guests);
      if (!qualifyingRooms) return [];
      const startingPrice = Math.min(
        ...qualifyingRooms.map((room) => room.pricePerNight),
      );
      return [
        {
          ...hotel,
          startingPrice,
          availableRoomsCount: availableRooms.length,
          availableRooms,
        },
      ];
    });

    results.sort((a, b) => {
      switch (sortBy) {
        case 'price_asc':
          return a.startingPrice - b.startingPrice;
        case 'price_desc':
          return b.startingPrice - a.startingPrice;
        case 'newest':
          return (
            new Date((b as { createdAt?: Date }).createdAt ?? 0).getTime() -
            new Date((a as { createdAt?: Date }).createdAt ?? 0).getTime()
          );
        case 'rating_desc':
        default:
          return (b.averageRating ?? 0) - (a.averageRating ?? 0);
      }
    });

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
    if (!hotel || hotel.isActive === false) {
      throw new NotFoundException(`Hotel with ID ${hotelId} not found`);
    }
    return hotel;
  }

  async findAvailableRooms(
    hotelId: string,
    checkIn: string,
    checkOut: string,
  ) {
    const hotel = await this.hotelModel.findById(hotelId).lean().exec();
    if (!hotel || hotel.isActive === false) {
      throw new NotFoundException('Hotel not found');
    }
    const { start, end } = this.parseAndValidateDates(checkIn, checkOut);
    const rooms = await this.roomModel
      .find({ hotelId: new Types.ObjectId(hotelId), isActive: { $ne: false } })
      .sort({ pricePerNight: 1, name: 1 })
      .lean()
      .exec();
    const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    const available = [];
    for (const room of rooms) {
      if (!(await this.checkAvailability(String(room._id), start, end))) continue;
      available.push({
        ...room,
        totalStayPrice: room.pricePerNight * nights,
      });
    }
    return {
      hotelId,
      checkIn: checkIn.slice(0, 10),
      checkOut: checkOut.slice(0, 10),
      nights,
      rooms: available,
    };
  }

  async getAvailability(
    hotelId: string,
    startDate: string,
    endDate: string,
  ) {
    const hotel = await this.hotelModel.findById(hotelId).lean().exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    const { start, end } = this.parseAndValidateDates(startDate, endDate);
    const rooms = await this.roomModel
      .find({ hotelId: new Types.ObjectId(hotelId) })
      .sort({ name: 1 })
      .lean()
      .exec();
    const entries = await this.roomAvailabilityModel
      .find({
        roomId: { $in: rooms.map((room) => room._id) },
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .sort({ startDate: 1 })
      .lean()
      .exec();
    const availabilityWindows = await this.roomAvailabilityModel
      .find({
        roomId: { $in: rooms.map((room) => room._id) },
        status: 'available',
      })
      .sort({ startDate: 1 })
      .lean()
      .exec();
    const byRoom = new Map<string, typeof entries>();
    for (const entry of entries) {
      const roomId = String(entry.roomId);
      byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), entry]);
    }
    const windowsByRoom = new Map<string, typeof availabilityWindows>();
    for (const window of availabilityWindows) {
      const roomId = String(window.roomId);
      windowsByRoom.set(roomId, [...(windowsByRoom.get(roomId) ?? []), window]);
    }
    return {
      hotelId,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      rooms: rooms.map((room) => {
        const ranges = byRoom.get(String(room._id)) ?? [];
        const blocking = ranges.find((range) =>
          range.status === 'maintenance'
            ? true
            : range.status === 'booked' ||
              (range.status === 'held' &&
                (!range.holdExpiresAt ||
                  range.holdExpiresAt.getTime() > Date.now())),
        );
        const windows = windowsByRoom.get(String(room._id)) ?? [];
        const available =
          !blocking &&
          room.isActive !== false &&
          hotel.isActive !== false &&
          (windows.length === 0 || coversDateRange(windows, start, end));
        return {
          roomId: String(room._id),
          name: room.name,
          status: blocking
            ? blocking.status === 'maintenance'
              ? 'Blocked'
              : 'Booked'
            : available
              ? 'Available'
              : 'Blocked',
          reservationReference:
            blocking?.status === 'booked'
              ? blocking.reservationReference ?? null
              : null,
        };
      }),
    };
  }

  async addRoomAvailability(
    hotelId: string,
    roomId: string,
    dto: CreateRoomAvailabilityDto,
  ) {
    await this.findRoomOfHotel(hotelId, roomId);
    const { start, end } = this.parseAndValidateDates(dto.checkIn, dto.checkOut);
    const id = await this.inventory.addRoomRange(
      roomId,
      start,
      end,
      dto.status ?? 'available',
    );
    return this.roomAvailabilityModel.findById(id).lean().exec();
  }

  async updateRoomAvailability(
    hotelId: string,
    roomId: string,
    rangeId: string,
    dto: UpdateRoomAvailabilityDto,
  ) {
    const room = await this.findRoomOfHotel(hotelId, roomId);
    if (!Types.ObjectId.isValid(rangeId)) {
      throw new NotFoundException('Room date range not found');
    }
    const current = await this.roomAvailabilityModel
      .findOne({
        _id: new Types.ObjectId(rangeId),
        roomId: room._id,
        status: { $in: ['available', 'maintenance'] },
      })
      .lean()
      .exec();
    if (!current) throw new NotFoundException('Room date range not found');
    const dates = this.parseAndValidateDates(
      dto.checkIn ?? current.startDate,
      dto.checkOut ?? current.endDate,
    );
    await this.inventory.updateRoomRange(roomId, rangeId, {
      ...dates,
      ...(dto.status ? { status: dto.status } : {}),
    });
    return this.roomAvailabilityModel.findById(rangeId).lean().exec();
  }

  private async findRoomOfHotel(hotelId: string, roomId: string) {
    if (!Types.ObjectId.isValid(hotelId) || !Types.ObjectId.isValid(roomId)) {
      throw new NotFoundException('Room not found');
    }
    const room = await this.roomModel
      .findOne({
        _id: new Types.ObjectId(roomId),
        hotelId: new Types.ObjectId(hotelId),
      })
      .exec();
    if (!room) throw new NotFoundException('Room not found in this hotel');
    return room;
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

  // --- HOTEL PHOTOS (HTL-01, GEN-08; added by Person 8) ---

  /**
   * Adds an uploaded photo (JPG/PNG, 5 MB). The push only happens while the
   * hotel has fewer than 5 photos, so parallel uploads can never exceed 5;
   * a rejected upload's file is deleted again.
   */
  async addHotelPhoto(
    hotelId: string,
    file: unknown,
  ): Promise<{ photos: string[] }> {
    const store = this.requirePhotoStore();
    const hotel = await this.hotelModel
      .findById(hotelId)
      .select('photos')
      .lean()
      .exec();
    if (!hotel) throw new NotFoundException('Hotel not found');
    if ((hotel.photos ?? []).length >= MAX_HOTEL_PHOTOS) {
      throw new BadRequestException(
        `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos`,
      );
    }

    const url = await store.upload(file, hotelId);
    const updated = await this.hotelModel
      .findOneAndUpdate(
        { _id: hotelId, [`photos.${MAX_HOTEL_PHOTOS - 1}`]: { $exists: false } },
        { $push: { photos: url } },
        { returnDocument: 'after' },
      )
      .select('photos')
      .lean()
      .exec();
    if (!updated) {
      await this.removePhotoFile(url, hotelId);
      const exists = await this.hotelModel.exists({ _id: hotelId }).exec();
      if (!exists) throw new NotFoundException('Hotel not found');
      throw new BadRequestException(
        `A hotel can have at most ${MAX_HOTEL_PHOTOS} photos`,
      );
    }
    return { photos: updated.photos };
  }

  /** Removes a photo (by its file name) from the hotel, then its file. */
  async removeHotelPhoto(
    hotelId: string,
    fileName: string,
  ): Promise<{ photos: string[] }> {
    this.requirePhotoStore();
    const url = `${UPLOADS_URL_PREFIX}/${fileName}`;
    const updated = await this.hotelModel
      .findOneAndUpdate(
        { _id: hotelId, photos: url },
        { $pull: { photos: url } },
        { returnDocument: 'after' },
      )
      .select('photos')
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('Photo not found on this hotel');
    await this.removePhotoFile(url, hotelId);
    return { photos: updated.photos };
  }

  private requirePhotoStore(): HotelPhotoStore {
    if (!this.photoStore) {
      throw new NotImplementedException('Hotel photo upload is not available');
    }
    return this.photoStore;
  }

  /**
   * Best effort, after the database change: a failure is only logged. Only
   * files uploaded for this hotel are deleted.
   */
  private async removePhotoFile(url: string, hotelId: string): Promise<void> {
    try {
      await this.photoStore?.remove(url, hotelId);
    } catch {
      this.logger.warn(`Could not delete hotel photo ${url}`);
    }
  }

  // --- ROOM METHODS ---

  async createRoom(
    hotelId: string,
    createRoomDto: CreateRoomDto,
  ): Promise<Room> {
    const hotel = await this.hotelModel.findById(hotelId).exec();
    if (!hotel || hotel.isActive === false) {
      throw new NotFoundException('Hotel not found or deactivated');
    }
    const createdRoom = new this.roomModel({
      ...createRoomDto,
      hotelId: new Types.ObjectId(hotelId),
    });
    return createdRoom.save();
  }

  async findRoomsByHotel(hotelId: string): Promise<Room[]> {
    const hotel = await this.hotelModel.findById(hotelId).lean().exec();
    if (!hotel || hotel.isActive === false) {
      throw new NotFoundException(`Hotel with ID ${hotelId} not found`);
    }
    return this.roomModel
      .find({ hotelId: hotel._id, isActive: { $ne: false } })
      .exec();
  }

  async roomBelongsToHotel(hotelId: string, roomId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(hotelId) || !Types.ObjectId.isValid(roomId)) {
      return false;
    }
    return (
      (await this.roomModel.exists({
        _id: new Types.ObjectId(roomId),
        hotelId: new Types.ObjectId(hotelId),
      })) !== null
    );
  }

  async updateRoom(
    hotelId: string,
    roomId: string,
    updateRoomDto: UpdateRoomDto,
  ): Promise<Room> {
    const room = await this.findRoomOfHotel(hotelId, roomId);
    await this.inventory.ensureLocks([roomId]);
    let updatedRoom: RoomDocument | null = null;
    await this.connection.transaction(async (session) => {
      await this.inventory.acquireRoomLocks(session, [room._id]);
      if (updateRoomDto.isActive === false) {
        const reservation = await this.roomAvailabilityModel
          .findOne({
            roomId: room._id,
            status: { $in: ['held', 'booked'] },
            endDate: { $gt: new Date() },
          })
          .session(session)
          .exec();
        if (reservation) {
          throw new ConflictException(
            'Cannot deactivate room while a reservation overlaps it.',
          );
        }
      }
      updatedRoom = await this.roomModel
        .findOneAndUpdate(
          { _id: room._id, hotelId: room.hotelId },
          { $set: updateRoomDto },
          { returnDocument: 'after', runValidators: true, session },
        )
        .exec();
    });
    if (!updatedRoom) throw new NotFoundException('Room not found');
    return updatedRoom;
  }

  async deleteRoom(
    hotelId: string,
    roomId: string,
  ): Promise<{ deleted: boolean; roomId: string }> {
    const room = await this.findRoomOfHotel(hotelId, roomId);
    if (!room) {
      throw new NotFoundException(`Room with ID ${roomId} not found`);
    }
    await this.inventory.ensureLocks([roomId]);
    await this.connection.transaction(async (session) => {
      await this.inventory.acquireRoomLocks(session, [room._id]);
      const entries = await this.roomAvailabilityModel
        .findOne({ roomId: room._id }, { _id: 1 })
        .session(session)
        .exec();
      if (entries) {
        throw new ConflictException(
          'A room can only be deleted if it has never been reserved or scheduled.',
        );
      }
      await this.roomModel
        .deleteOne({ _id: room._id, hotelId: room.hotelId }, { session })
        .exec();
    });

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
    if (
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()) <
      Date.UTC(
        new Date().getUTCFullYear(),
        new Date().getUTCMonth(),
        new Date().getUTCDate(),
      )
    ) {
      throw new BadRequestException('Check-in cannot be in the past');
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

    const ranges = await this.roomAvailabilityModel
      .find({
        roomId: room._id,
        startDate: { $lt: end },
        endDate: { $gt: start },
      })
      .lean()
      .exec();
    const now = new Date();
    const blocked = ranges.some(
      (range) =>
        range.status === 'booked' ||
        range.status === 'maintenance' ||
        (range.status === 'held' &&
          (!range.holdExpiresAt || range.holdExpiresAt > now)),
    );
    if (blocked) return false;
    const windows = await this.roomAvailabilityModel
      .find({ roomId: room._id, status: 'available' })
      .select('startDate endDate')
      .lean()
      .exec();
    return (
      windows.length === 0 || coversDateRange(windows, start, end)
    );
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

  async confirmDates(
    bookingReference: string,
    reservationReference?: string,
  ): Promise<void> {
    await this.roomAvailabilityModel
      .updateMany(
        { bookingReference },
        {
          $set: {
            status: 'booked',
            ...(reservationReference ? { reservationReference } : {}),
            holdExpiresAt: null,
          },
        },
      )
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

    const room = await this.roomModel.findById(roomId).exec();
    if (!room) throw new NotFoundException('Room not found');
    const id = await this.inventory.addRoomRange(
      roomId,
      start,
      end,
      blockRoomDto.status === 'available' ? 'available' : 'maintenance',
    );
    const block = await this.roomAvailabilityModel.findById(id).exec();
    if (!block) throw new NotFoundException('Room date range not found');
    return block;
  }
}

function coversDateRange(
  windows: Array<{ startDate: Date; endDate: Date }>,
  start: Date,
  end: Date,
): boolean {
  const sorted = [...windows].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  let cursor = start.getTime();
  for (const window of sorted) {
    if (window.startDate.getTime() > cursor) return false;
    cursor = Math.max(cursor, window.endDate.getTime());
    if (cursor >= end.getTime()) return true;
  }
  return false;
}

function chooseRooms(
  availableRooms: any[],
  roomsRequired: number,
  guests: number,
): any[] | null {
  if (availableRooms.length < roomsRequired) return null;
  const states = Array.from({ length: roomsRequired + 1 }, () =>
    Array.from({ length: guests + 1 }, () => null as any[] | null),
  );
  states[0][0] = [];
  for (const room of availableRooms) {
    const capacity =
      Number(room.occupancy?.maxAdults ?? 0) +
      Number(room.occupancy?.maxChildren ?? 0);
    for (let count = roomsRequired; count >= 1; count--) {
      for (let covered = guests; covered >= 0; covered--) {
        const prior = states[count - 1][covered];
        if (!prior) continue;
        const nextCovered = Math.min(guests, covered + capacity);
        const candidate = [...prior, room];
        const current = states[count][nextCovered];
        const candidatePrice = candidate.reduce(
          (sum, item) => sum + Number(item.pricePerNight),
          0,
        );
        const currentPrice = current?.reduce(
          (sum, item) => sum + Number(item.pricePerNight),
          0,
        );
        if (currentPrice === undefined || candidatePrice < currentPrice) {
          states[count][nextCovered] = candidate;
        }
      }
    }
  }
  return states[roomsRequired][guests];
}