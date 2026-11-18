import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { QuoteHotelBookingDto } from './dto/quote-hotel-booking.dto';
import { holdExpiryFor } from './hotel-booking.constants';
import {
  HotelBookingLifecycleService,
  holdKeyOf,
} from './hotel-booking-lifecycle.service';
import { HotelBookingStatus } from './hotel-booking-status';
import {
  HotelBookingQuoteRoom,
  HotelBookingsService,
} from './hotel-bookings.service';
import { RoomInventoryService } from './room-inventory.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { parseDateOnly } from './stay-rules';

export interface HotelBookingHold {
  id: string;
  status: HotelBookingStatus;
  /** Pay before this instant or the booking becomes Expired. */
  holdExpiresAt: Date;
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
export class HotelBookingHoldService {
  constructor(
    private readonly quotes: HotelBookingsService,
    private readonly lifecycle: HotelBookingLifecycleService,
    private readonly inventory: RoomInventoryService,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * HTL-18: hold every selected room together for 10 minutes as one Pending
   * Payment reservation. The same validation as the HTL-16 quote applies
   * (dates, guests, occupancy). If any room overlaps a Confirmed reservation,
   * an unexpired hold or a blocked range, the whole request is rejected with
   * 409 and nothing is held.
   */
  async hold(
    userId: string,
    dto: QuoteHotelBookingDto,
    now: Date = new Date(),
  ): Promise<HotelBookingHold> {
    // Holds that already ran out must not block this request.
    await this.lifecycle.releaseExpiredHolds(now);

    const quote = await this.quotes.quote(dto, now);
    const bookingId = new Types.ObjectId();
    const checkIn = parseDateOnly(quote.checkIn) as Date;
    const checkOut = parseDateOnly(quote.checkOut) as Date;
    const holdExpiresAt = holdExpiryFor(now);
    const roomIds = quote.rooms.map((room) => room.roomId);

    await this.inventory.ensureLocks(roomIds);

    // One transaction: the room dates and the booking are held together or
    // not at all. The helper retries when a concurrent hold wins a room.
    await this.connection.transaction(async (session) => {
      await this.inventory.hold(session, {
        holdKey: holdKeyOf(String(bookingId)),
        roomIds,
        checkIn,
        checkOut,
        now,
      });
      await this.bookings.create(
        [
          {
            _id: bookingId,
            userId: new Types.ObjectId(userId),
            hotelId: new Types.ObjectId(quote.hotelId),
            hotelName: quote.hotelName,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            nights: quote.nights,
            rooms: quote.rooms.map((room) => ({
              roomId: new Types.ObjectId(room.roomId),
              roomName: room.roomName,
              pricePerNight: room.pricePerNight,
              adults: room.adults,
              childrenAges: room.childrenAges,
              subtotal: room.subtotal,
            })),
            totalPrice: quote.totalPrice,
            currency: quote.currency,
            status: HotelBookingStatus.PENDING_PAYMENT,
            holdExpiresAt,
          },
        ],
        { session },
      );
    });

    return {
      id: String(bookingId),
      status: HotelBookingStatus.PENDING_PAYMENT,
      holdExpiresAt,
      hotelId: quote.hotelId,
      hotelName: quote.hotelName,
      checkIn: quote.checkIn,
      checkOut: quote.checkOut,
      nights: quote.nights,
      rooms: quote.rooms,
      totalPrice: quote.totalPrice,
      currency: quote.currency,
    };
  }
}