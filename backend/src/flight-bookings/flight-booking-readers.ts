import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  FlightBookingReader,
  FlightBookingRecord,
} from '../airlines/flight-booking-reader';
import type { FlightPassengerReader } from '../airlines/flight-passenger-reader';
import { FlightBookingStatus } from './flight-booking-status';
import type { LeanBooking } from './flight-bookings.service';
import { FlightBooking } from './schemas/flight-booking.schema';

/**
 * Read-only views of flight bookings for Person 3's flight module, which
 * must not query the booking collection itself.
 */
@Injectable()
export class FlightBookingReaders
  implements FlightPassengerReader, FlightBookingReader
{
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
  ) {}

  /** FLT-05: users with a Confirmed booking on the flight, notified of schedule changes. */
  async findConfirmedPassengerIds(flightId: string): Promise<string[]> {
    const ids = await this.bookingModel
      .distinct('userId', {
        'segments.flightId': new Types.ObjectId(flightId),
        status: FlightBookingStatus.CONFIRMED,
      })
      .exec();
    return ids.map((id) => String(id));
  }

  /**
   * FLT-29: a flight's bookings for its moderator: reference, passenger
   * names, cabin, seats and status. Confirmed and Cancelled as the
   * requirement lists, plus Completed so a departed flight is not empty.
   * Unpaid holds are not bookings yet and are left out.
   */
  async listByFlightId(flightId: string): Promise<FlightBookingRecord[]> {
    const id = new Types.ObjectId(flightId);
    const bookings = await this.bookingModel
      .find({
        'segments.flightId': id,
        status: {
          $in: [
            FlightBookingStatus.CONFIRMED,
            FlightBookingStatus.CANCELLED,
            FlightBookingStatus.COMPLETED,
          ],
        },
      })
      .sort({ createdAt: 1, _id: 1 })
      .lean<LeanBooking[]>()
      .exec();

    return bookings.map((booking) => {
      const segment = booking.segments.find((s) => s.flightId.equals(id))!;
      return {
        id: booking._id.toString(),
        bookingReference: booking.bookingReference ?? '',
        passengers: booking.passengers.map((passenger) => ({
          id: passenger._id!.toString(),
          name: passenger.fullName,
        })),
        cabin: segment.cabinCategory,
        seats: segment.seats,
        status: booking.status,
      };
    });
  }
}
