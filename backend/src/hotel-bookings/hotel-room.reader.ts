import { Injectable, NotFoundException } from '@nestjs/common';

import { HotelsService } from '../hotels/hotels.service';
import type { HotelDocument } from '../hotels/schemas/hotel.schema';
import type { RoomDocument } from '../hotels/schemas/room.schema';

/**
 * What the booking module needs to know about hotels, rooms and availability.
 * It only depends on this interface, so the hotels module can change freely
 * behind the adapter below.
 */
export interface BookableHotel {
  id: string;
  name: string;
  isActive: boolean;
}

export interface BookableRoom {
  id: string;
  hotelId: string;
  name: string;
  pricePerNight: number;
  maxAdults: number;
  maxChildren: number;
  isActive: boolean;
}

export interface HotelRoomReader {
  findHotel(hotelId: string): Promise<BookableHotel | null>;
  /** All rooms of one hotel (so a room of another hotel is simply absent). */
  findRoomsOfHotel(hotelId: string): Promise<BookableRoom[]>;
  /** Advisory check: no hold, booking or block overlaps [checkIn, checkOut). */
  isRoomAvailable(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
  ): Promise<boolean>;
  /** HTL-17: held -> booked for every room date held under `holdKey`. */
  confirmRoomDates(holdKey: string): Promise<void>;
}

export const HOTEL_ROOM_READER = Symbol('HOTEL_ROOM_READER');

/** Adapter over Person 5's HotelsService (needs HotelsModule to export it). */
@Injectable()
export class HotelsServiceRoomReader implements HotelRoomReader {
  constructor(private readonly hotels: HotelsService) {}

  async findHotel(hotelId: string): Promise<BookableHotel | null> {
    try {
      const hotel = (await this.hotels.findHotelById(
        hotelId,
      )) as unknown as HotelDocument;
      return {
        id: String(hotel._id),
        name: hotel.name,
        isActive: hotel.isActive !== false,
      };
    } catch (error) {
      if (error instanceof NotFoundException) return null;
      throw error;
    }
  }

  async findRoomsOfHotel(hotelId: string): Promise<BookableRoom[]> {
    const rooms = (await this.hotels.findRoomsByHotel(
      hotelId,
    )) as unknown as RoomDocument[];
    return rooms.map((room) => ({
      id: String(room._id),
      hotelId: String(room.hotelId),
      name: room.name,
      pricePerNight: room.pricePerNight,
      // A missing limit means 0, so a malformed room can never be oversold.
      maxAdults: room.occupancy?.maxAdults ?? 0,
      maxChildren: room.occupancy?.maxChildren ?? 0,
      isActive: room.isActive !== false,
    }));
  }

  isRoomAvailable(
    roomId: string,
    checkIn: Date,
    checkOut: Date,
  ): Promise<boolean> {
    return this.hotels.checkAvailability(roomId, checkIn, checkOut);
  }

  confirmRoomDates(holdKey: string): Promise<void> {
    return this.hotels.confirmDates(holdKey);
  }
}