import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Hotel, HotelDocument } from './schemas/hotel.schema';
import { Room, RoomDocument } from './schemas/room.schema';
import { RoomAvailability, RoomAvailabilityDocument } from './schemas/room-availability.schema';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { BlockRoomDto } from './dto/block-room.dto';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private hotelModel: Model<HotelDocument>,
    @InjectModel(Room.name) private roomModel: Model<RoomDocument>,
    @InjectModel(RoomAvailability.name) private roomAvailabilityModel: Model<RoomAvailabilityDocument>,
  ) {}

  async createHotel(createHotelDto: CreateHotelDto): Promise<Hotel> {
    const createdHotel = new this.hotelModel(createHotelDto);
    return createdHotel.save();
  }

  async findAllHotels(): Promise<Hotel[]> {
    return this.hotelModel.find({ isActive: true }).exec();
  }

  async createRoom(createRoomDto: CreateRoomDto): Promise<Room> {
    const createdRoom = new this.roomModel(createRoomDto);
    return createdRoom.save();
  }

  async findRoomsByHotel(hotelId: string): Promise<Room[]> {
    return this.roomModel.find({ hotelId }).exec();
  }

  // --- NEW AVAILABILITY METHODS ---

  async blockRoom(roomId: string, blockRoomDto: BlockRoomDto): Promise<RoomAvailability> {
    const block = new this.roomAvailabilityModel({
      roomId,
      ...blockRoomDto,
    });
    return block.save();
  }
}