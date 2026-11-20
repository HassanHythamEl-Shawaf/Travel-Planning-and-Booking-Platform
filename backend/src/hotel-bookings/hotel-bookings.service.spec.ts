import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { HotelBookingsService } from './hotel-bookings.service';
import {
  BookableHotel,
  BookableRoom,
  HotelRoomReader,
} from './hotel-room.reader';

const NOW = new Date('2026-11-17T10:00:00Z');
const HOTEL_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const R1 = '111111111111111111111111';
const R2 = '222222222222222222222222';
const R_OTHER = '333333333333333333333333';

function build(
  hotel: Partial<BookableHotel> | null = {},
  rooms?: BookableRoom[],
  unavailable: string[] = [],
) {
  const base: BookableRoom[] = rooms ?? [
    { id: R1, hotelId: HOTEL_ID, name: 'Deluxe', pricePerNight: 100, maxAdults: 2, maxChildren: 1, isActive: true },
    { id: R2, hotelId: HOTEL_ID, name: 'Suite', pricePerNight: 150.5, maxAdults: 2, maxChildren: 0, isActive: true },
    { id: R_OTHER, hotelId: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Elsewhere', pricePerNight: 80, maxAdults: 2, maxChildren: 0, isActive: true },
  ];
  const reader: HotelRoomReader = {
    findHotel: async () =>
      hotel === null ? null : { id: HOTEL_ID, name: 'Hilton Cairo', isActive: true, ...hotel },
    findRoomsOfHotel: async (hotelId) =>
      base.filter((r) => r.hotelId === hotelId),
    isRoomAvailable: async (roomId) => !unavailable.includes(roomId),
  };
  return new HotelBookingsService(reader);
}

const dto = (rooms: QuoteHotelBookingDto['rooms']): QuoteHotelBookingDto => ({
  hotelId: HOTEL_ID,
  checkIn: '2026-12-20',
  checkOut: '2026-12-23',
  rooms,
});

describe('HotelBookingsService.quote (HTL-16)', () => {
  it('sums nights x each room price over several rooms', async () => {
    const quote = await build().quote(
      dto([
        { roomId: R1, adults: 2, childrenAges: [6] },
        { roomId: R2, adults: 1 },
      ]),
      NOW,
    );
    expect(quote.nights).toBe(3);
    expect(quote.rooms.map((r) => r.subtotal)).toEqual([300, 451.5]);
    expect(quote.totalPrice).toBe(751.5);
    expect(quote.hotelName).toBe('Hilton Cairo');
  });

  it('rejects a room over its adult or child limit', async () => {
    await expect(
      build().quote(dto([{ roomId: R2, adults: 2, childrenAges: [3] }]), NOW),
    ).rejects.toThrow(/at most 0 children/);
    await expect(
      build().quote(dto([{ roomId: R1, adults: 3 }]), NOW),
    ).rejects.toThrow(/at most 2 adults/);
  });

  it('rejects a reservation without any adult', async () => {
    await expect(
      build().quote(dto([{ roomId: R1, adults: 0, childrenAges: [9] }]), NOW),
    ).rejects.toThrow(/at least one adult/);
  });

  it('rejects rooms of another hotel, inactive rooms and duplicates', async () => {
    await expect(
      build().quote(dto([{ roomId: R_OTHER, adults: 1 }]), NOW),
    ).rejects.toThrow(/does not belong/);
    await expect(
      build(
        {},
        [{ id: R1, hotelId: HOTEL_ID, name: 'Deluxe', pricePerNight: 100, maxAdults: 2, maxChildren: 1, isActive: false }],
      ).quote(dto([{ roomId: R1, adults: 1 }]), NOW),
    ).rejects.toThrow(/not available/);
    await expect(
      build().quote(
        dto([{ roomId: R1, adults: 1 }, { roomId: R1, adults: 1 }]),
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a room that is held, booked or blocked for the dates', async () => {
    await expect(
      build({}, undefined, [R2]).quote(
        dto([{ roomId: R1, adults: 1 }, { roomId: R2, adults: 1 }]),
        NOW,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('hides missing and deactivated hotels', async () => {
    await expect(
      build(null).quote(dto([{ roomId: R1, adults: 1 }]), NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      build({ isActive: false }).quote(dto([{ roomId: R1, adults: 1 }]), NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});