import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PLATFORM_CURRENCY } from '../flight-bookings/flight-booking.constants';
import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { HOTEL_ROOM_READER } from './hotel-room.reader';
import type { HotelRoomReader } from './hotel-room.reader';
import {
  countNights,
  occupancyError,
  parseDateOnly,
  reservationAdultError,
  roomSubtotal,
  startOfUtcDay,
  stayError,
  sumPrices,
} from './stay-rules';

export interface HotelBookingQuoteRoom {
  roomId: string;
  roomName: string;
  adults: number;
  childrenAges: number[];
  pricePerNight: number;
  nights: number;
  subtotal: number;
}

export interface HotelBookingQuote {
  hotelId: string;
  hotelName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  rooms: HotelBookingQuoteRoom[];
  totalPrice: number;
  currency: string;
}

@Injectable()
export class HotelBookingsService {
  constructor(
    @Inject(HOTEL_ROOM_READER) private readonly reader: HotelRoomReader,
  ) {}

  /**
   * HTL-16: validate a multi-room request and return the price summary.
   * Saves nothing and holds nothing; the hold is added by HTL-18.
   */
  async quote(
    dto: QuoteHotelBookingDto,
    now: Date = new Date(),
  ): Promise<HotelBookingQuote> {
    const checkIn = parseDateOnly(dto.checkIn);
    const checkOut = parseDateOnly(dto.checkOut);
    if (!checkIn || !checkOut) {
      throw new BadRequestException('Dates must be real YYYY-MM-DD dates');
    }
    const dateProblem = stayError(checkIn, checkOut, startOfUtcDay(now));
    if (dateProblem) throw new BadRequestException(dateProblem);

    const requested = dto.rooms.map((room) => ({
      roomId: room.roomId,
      adults: room.adults,
      childrenAges: room.childrenAges ?? [],
    }));

    if (new Set(requested.map((r) => r.roomId)).size !== requested.length) {
      throw new BadRequestException('A room can appear only once');
    }
    const adultProblem = reservationAdultError(requested);
    if (adultProblem) throw new BadRequestException(adultProblem);

    const hotel = await this.reader.findHotel(dto.hotelId);
    if (!hotel || !hotel.isActive) {
      throw new NotFoundException('Hotel not found');
    }

    const found = await this.reader.findRoomsOfHotel(hotel.id);
    const byId = new Map(found.map((room) => [room.id, room]));
    const nights = countNights(checkIn, checkOut);

    const rooms = requested.map((guests): HotelBookingQuoteRoom => {
      const room = byId.get(guests.roomId);
      if (!room) {
        throw new BadRequestException(
          `Room ${guests.roomId} does not belong to this hotel`,
        );
      }
      if (!room.isActive) {
        throw new BadRequestException(`Room "${room.name}" is not available`);
      }
      const problem = occupancyError(room.name, guests, {
        maxAdults: room.maxAdults,
        maxChildren: room.maxChildren,
      });
      if (problem) throw new BadRequestException(problem);
      return {
        roomId: room.id,
        roomName: room.name,
        adults: guests.adults,
        childrenAges: guests.childrenAges,
        pricePerNight: room.pricePerNight,
        nights,
        subtotal: roomSubtotal(room.pricePerNight, nights),
      };
    });

    // Advisory only: HTL-18 re-checks atomically when the rooms are held.
    for (const line of rooms) {
      if (!(await this.reader.isRoomAvailable(line.roomId, checkIn, checkOut))) {
        throw new ConflictException(
          `Room "${line.roomName}" is not available for the selected dates`,
        );
      }
    }

    return {
      hotelId: hotel.id,
      hotelName: hotel.name,
      checkIn: dto.checkIn,
      checkOut: dto.checkOut,
      nights,
      rooms,
      totalPrice: sumPrices(rooms.map((room) => room.subtotal)),
      currency: PLATFORM_CURRENCY,
    };
  }
}