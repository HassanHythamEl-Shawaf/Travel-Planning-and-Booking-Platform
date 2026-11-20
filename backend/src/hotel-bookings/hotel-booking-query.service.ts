import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
import { ListHotelReservationsQueryDto } from './dto/list-hotel-reservations.dto';
import { parseDateOnly } from './stay-rules';
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

  async listForHotel(
    hotelId: string,
    query: ListHotelReservationsQueryDto,
  ) {
    if (!Types.ObjectId.isValid(hotelId)) {
      throw new NotFoundException('Hotel not found');
    }
    const from = query.from ? parseDateOnly(query.from) : undefined;
    const to = query.to ? parseDateOnly(query.to) : undefined;
    if ((query.from && !from) || (query.to && !to)) {
      throw new BadRequestException('Reservation dates must use YYYY-MM-DD');
    }
    if (from && to && from >= to) {
      throw new BadRequestException('from must be earlier than to');
    }
    const { skip, limit } = getPagination(query.page);
    const filter: Record<string, unknown> = {
      hotelId: new Types.ObjectId(hotelId),
    };
    if (query.status) filter.status = query.status;
    if (query.from || query.to) {
      filter.checkInDate = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }
    const [rows, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ checkInDate: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.bookings.countDocuments(filter).exec(),
    ]);
    return {
      data: (rows as unknown as LeanHotelBooking[]).map(toSummary),
      total,
      page: Math.floor(skip / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}