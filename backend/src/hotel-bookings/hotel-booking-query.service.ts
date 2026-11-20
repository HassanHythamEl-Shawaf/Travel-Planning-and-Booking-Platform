import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import {
  GROUP_SORT,
  groupFilter,
  HotelBookingDetails,
  HotelBookingSummary,
  LeanHotelBooking,
  toDetails,
  toSummary,
} from './booking-view';
import {
  HOTEL_BOOKING_GROUPS,
  HotelBookingGroup,
} from './hotel-booking-group';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

export interface HotelBookingList {
  data: HotelBookingSummary[];
  /** Bookings in the requested group. */
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Size of every group, for the tab badges. */
  counts: Record<HotelBookingGroup, number>;
}

@Injectable()
export class HotelBookingQueryService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
  ) {}

  /** HTL-20: my reservations of one group, 10 per page, with every group's size. */
  async listMine(
    userId: string,
    group: HotelBookingGroup,
    page?: number,
    now: Date = new Date(),
  ): Promise<HotelBookingList> {
    const { skip, limit } = getPagination(page);
    const owner = { userId: new Types.ObjectId(userId) };

    const rows = (await this.bookings
      .find({ ...owner, ...groupFilter(group, now) })
      .sort(GROUP_SORT[group])
      .skip(skip)
      .limit(limit)
      .lean()
      .exec()) as unknown as LeanHotelBooking[];

    const sizes = await Promise.all(
      HOTEL_BOOKING_GROUPS.map((g) =>
        this.bookings
          .countDocuments({ ...owner, ...groupFilter(g, now) })
          .exec(),
      ),
    );
    const counts = Object.fromEntries(
      HOTEL_BOOKING_GROUPS.map((g, i) => [g, sizes[i]]),
    ) as Record<HotelBookingGroup, number>;

    const total = counts[group];
    return {
      data: rows.map(toSummary),
      total,
      page: Math.floor(skip / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit),
      counts,
    };
  }

  /** HTL-20: full details of one of my reservations (anyone else's is "not found"). */
  async getMine(
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<HotelBookingDetails> {
    const booking =
      Types.ObjectId.isValid(id) && Types.ObjectId.isValid(userId)
        ? ((await this.bookings
            .findOne({
              _id: new Types.ObjectId(id),
              userId: new Types.ObjectId(userId),
            })
            .lean()
            .exec()) as unknown as LeanHotelBooking | null)
        : null;
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return toDetails(booking, now);
  }
}