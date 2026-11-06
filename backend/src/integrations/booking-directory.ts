import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, PipelineStage, Types } from 'mongoose';

import type { ProviderType } from '../auth/decorators/provider-ownership.decorator';
import { Paginated, Pagination } from '../common/pagination';
import {
  BOOKING_COLLECTIONS,
  BOOKING_FIELDS,
  BOOKING_STATUS,
  BookingStatus,
  BookingType,
  USERS_COLLECTION,
} from './teammate-contracts';

export const BOOKING_DIRECTORY = Symbol('BOOKING_DIRECTORY');

export interface AdminBookingFilter {
  type?: BookingType;
  status?: BookingStatus;
  /** Inclusive lower bound on the booking's createdAt. */
  from?: Date;
  /** Inclusive upper bound on the booking's createdAt. */
  to?: Date;
}

export interface AdminBookingRow {
  id: string;
  type: BookingType;
  bookingReference: string | null;
  status: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  providerId: string | null;
  totalPrice: number | null;
  currency: string | null;
  createdAt: Date;
}

export interface BookingDirectory {
  findUserIdsWithUpcomingConfirmedBookings(
    type: ProviderType,
    providerId: string,
  ): Promise<string[]>;
  listAll(
    filter: AdminBookingFilter,
    page: Pagination,
  ): Promise<Paginated<AdminBookingRow>>;
}

const BOOKING_TYPE_FOR_PROVIDER: Record<ProviderType, BookingType> = {
  airline: 'flight',
  hotel: 'hotel',
};

interface RawRow {
  _id: Types.ObjectId;
  type: BookingType;
  bookingReference: string | null;
  status: string;
  userId: Types.ObjectId | null;
  providerId: Types.ObjectId | null;
  totalPrice: number | null;
  currency: string | null;
  createdAt: Date;
  user?: { name?: string; email?: string }[];
}

/**
 * Reads teammates' booking collections through the raw driver. MongoDB treats
 * a missing collection as empty, so nothing here throws before Persons 3–6
 * have created their collections.
 */
@Injectable()
export class MongoBookingDirectory implements BookingDirectory {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findUserIdsWithUpcomingConfirmedBookings(
    type: ProviderType,
    providerId: string,
  ): Promise<string[]> {
    if (!Types.ObjectId.isValid(providerId)) return [];
    const bookingType = BOOKING_TYPE_FOR_PROVIDER[type];
    const fields = BOOKING_FIELDS[bookingType];
    const ids = await this.connection
      .collection(BOOKING_COLLECTIONS[bookingType])
      .distinct('userId', {
        [fields.providerId]: new Types.ObjectId(providerId),
        status: BOOKING_STATUS.CONFIRMED,
        [fields.startsAt]: { $gt: new Date() },
      });
    return ids
      .filter((id): id is Types.ObjectId => id != null)
      .map((id) => id.toString());
  }

  async listAll(
    filter: AdminBookingFilter,
    page: Pagination,
  ): Promise<Paginated<AdminBookingRow>> {
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new BadRequestException('"from" must not be after "to"');
    }

    const types: BookingType[] = filter.type
      ? [filter.type]
      : ['flight', 'hotel'];
    const [first, ...rest] = types;

    const pipeline: PipelineStage[] = [
      ...branch(first, filter),
      ...rest.map((type): PipelineStage => ({
        $unionWith: {
          coll: BOOKING_COLLECTIONS[type],
          pipeline: branch(type, filter) as never,
        },
      })),
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: page.skip },
            { $limit: page.limit },
            {
              $lookup: {
                from: USERS_COLLECTION,
                localField: 'userId',
                foreignField: '_id',
                as: 'user',
                pipeline: [{ $project: { name: 1, email: 1 } }],
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.connection
      .collection(BOOKING_COLLECTIONS[first])
      .aggregate<{ items: RawRow[]; total: { count: number }[] }>(pipeline)
      .toArray();

    const total = result?.total[0]?.count ?? 0;
    return {
      items: (result?.items ?? []).map(toRow),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }
}

/** Filters one booking collection and normalises it to the shared row shape. */
function branch(
  type: BookingType,
  filter: AdminBookingFilter,
): PipelineStage[] {
  const match: Record<string, unknown> = {};
  if (filter.status) match.status = filter.status;
  if (filter.from || filter.to) {
    match.createdAt = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lte: filter.to }),
    };
  }
  return [
    { $match: match },
    {
      $project: {
        _id: 1,
        type: { $literal: type },
        bookingReference: { $ifNull: ['$bookingReference', null] },
        status: 1,
        userId: 1,
        providerId: { $ifNull: [`$${BOOKING_FIELDS[type].providerId}`, null] },
        totalPrice: { $ifNull: ['$totalPrice', null] },
        currency: { $ifNull: ['$currency', null] },
        createdAt: 1,
      },
    },
  ];
}

function toRow(raw: RawRow): AdminBookingRow {
  const user = raw.user?.[0];
  return {
    id: raw._id.toString(),
    type: raw.type,
    bookingReference: raw.bookingReference,
    status: raw.status,
    userId: raw.userId?.toString() ?? '',
    userName: user?.name ?? null,
    userEmail: user?.email ?? null,
    providerId: raw.providerId?.toString() ?? null,
    totalPrice: raw.totalPrice,
    currency: raw.currency,
    createdAt: raw.createdAt,
  };
}
