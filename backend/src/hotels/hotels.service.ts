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
    return this.hotelModel.find({ isActive: true }).exec();
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
    if (!hotel || !hotel.isActive || !room.isActive) {
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