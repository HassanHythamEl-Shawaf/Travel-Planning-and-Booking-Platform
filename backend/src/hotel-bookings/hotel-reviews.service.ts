import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';

import { getPagination } from '../common/pagination';
import {
  PROVIDER_COLLECTIONS,
  USERS_COLLECTION,
} from '../integrations/teammate-contracts';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { AccountStatus } from '../users/schemas/user.schema';
import { HotelBookingStatus } from './hotel-booking-status';
import { HOTEL_ROOM_READER } from './hotel-room.reader';
import type { HotelRoomReader } from './hotel-room.reader';
import {
  endedStayFilter,
  normalizeComment,
  reviewEligibility,
  reviewInputError,
  roundRating,
} from './review-rules';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';
import { Review, ReviewDocument } from './schemas/review.schema';

const DELETED_USER = 'Deleted user';

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: number } | null)?.code === 11000;

/** What the author sees of their own review. */
export interface MyReview {
  id: string;
  bookingId: string;
  hotelId: string;
  rating: number;
  comment: string | null;
  isHidden: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HotelReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  reviewerName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HotelReviewList {
  /** Average over the visible reviews, 0 when there are none. */
  averageRating: number;
  /** Number of ratings: every visible review carries exactly one. */
  ratingCount: number;
  data: HotelReviewItem[];
  /** Same as ratingCount; the pagination total. */
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type LeanReview = Review & { _id: Types.ObjectId };

@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Review.name)
    private readonly reviews: Model<ReviewDocument>,
    @InjectConnection() private readonly connection: Connection,
    @Inject(HOTEL_ROOM_READER) private readonly reader: HotelRoomReader,
  ) {}

  /**
   * HTL-23: one rating (1-5) and an optional comment per Completed
   * reservation, whatever its number of rooms. A Confirmed reservation past
   * check-out is completed on the spot.
   */
  async create(
    userId: string,
    bookingId: string,
    dto: CreateReviewDto,
    now: Date = new Date(),
  ): Promise<MyReview> {
    const comment = normalizeComment(dto.comment);
    this.assertValid(dto.rating, comment);

    const booking = await this.findOwnBooking(userId, bookingId);
    const eligibility = reviewEligibility(
      booking.status,
      booking.checkOutDate,
      now,
    );
    if (eligibility === 'not-reviewable') {
      throw new ConflictException(
        `Only a completed stay can be reviewed (this reservation is ${booking.status})`,
      );
    }
    if (eligibility === 'needs-completion') {
      await this.bookings
        .updateOne(
          { _id: booking._id, ...endedStayFilter(now) },
          { $set: { status: HotelBookingStatus.COMPLETED, completedAt: now } },
        )
        .exec();
    }
    if (await this.reviews.exists({ bookingId: booking._id })) {
      throw new ConflictException('This reservation already has a review');
    }

    const outcome: { review: ReviewDocument | null } = { review: null };
    try {
      await this.connection.transaction(async (session) => {
        outcome.review = null;
        const [created] = await this.reviews.create(
          [
            {
              userId: booking.userId,
              hotelId: booking.hotelId,
              bookingId: booking._id,
              rating: dto.rating,
              comment,
            },
          ],
          { session },
        );
        outcome.review = created;
        await this.recomputeRating(booking.hotelId, session);
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException('This reservation already has a review');
      }
      throw error;
    }
    return this.toMine(outcome.review as ReviewDocument);
  }

  /** Edit my own review's rating and/or comment; the average follows. */
  async update(
    userId: string,
    reviewId: string,
    dto: UpdateReviewDto,
  ): Promise<MyReview> {
    if (dto.rating === undefined && dto.comment === undefined) {
      throw new BadRequestException('Send a rating and/or a comment to change');
    }
    const comment =
      dto.comment === undefined ? undefined : normalizeComment(dto.comment);
    this.assertValid(dto.rating, comment ?? null);

    const changes: Record<string, unknown> = {};
    if (dto.rating !== undefined) changes.rating = dto.rating;
    if (comment !== undefined) changes.comment = comment;

    const outcome: { review: ReviewDocument | null } = { review: null };
    await this.connection.transaction(async (session) => {
      outcome.review = await this.reviews
        .findOneAndUpdate(
          { _id: this.oid(reviewId), userId: this.oid(userId) },
          { $set: changes },
          { returnDocument: 'after', session, runValidators: true },
        )
        .exec();
      if (!outcome.review) throw new NotFoundException('Review not found');
      await this.recomputeRating(outcome.review.hotelId, session);
    });
    return this.toMine(outcome.review as ReviewDocument);
  }

  /** Delete my own review; the average follows and the stay can be reviewed again. */
  async remove(
    userId: string,
    reviewId: string,
  ): Promise<{ deleted: true; reviewId: string }> {
    await this.connection.transaction(async (session) => {
      const removed = await this.reviews
        .findOneAndDelete(
          { _id: this.oid(reviewId), userId: this.oid(userId) },
          { session },
        )
        .exec();
      if (!removed) throw new NotFoundException('Review not found');
      await this.recomputeRating(removed.hotelId, session);
    });
    return { deleted: true, reviewId };
  }

  /**
   * HTL-24: a hotel's average rating, number of ratings and visible reviews,
   * newest first, 10 per page. Public: guests and users see the same.
   */
  async listForHotel(hotelId: string, page?: number): Promise<HotelReviewList> {
    const hotel = await this.reader.findHotel(hotelId);
    if (!hotel || !hotel.isActive) throw new NotFoundException('Hotel not found');

    const { skip, limit } = getPagination(page);
    const match = { hotelId: this.oid(hotelId), isHidden: { $ne: true } };

    const [summary] = await this.reviews
      .aggregate<{ avg: number; count: number }>([
        { $match: match },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ])
      .exec();
    const total = summary?.count ?? 0;

    const rows = (await this.reviews
      .find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
      .exec()) as unknown as LeanReview[];

    const names = await this.reviewerNames(rows.map((row) => row.userId));
    return {
      averageRating: summary ? roundRating(summary.avg) : 0,
      ratingCount: total,
      data: rows.map((row) => ({
        id: String(row._id),
        rating: row.rating,
        comment: row.comment ?? null,
        reviewerName: names.get(String(row.userId)) ?? DELETED_USER,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      total,
      page: Math.floor(skip / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Recalculates a hotel's averageRating from its visible reviews. Call it
   * after anything that changes a review's visibility (admin hide/unhide).
   */
  async recomputeHotelRating(hotelId: string): Promise<number> {
    const outcome = { average: 0 };
    await this.connection.transaction(async (session) => {
      outcome.average = await this.recomputeRating(this.oid(hotelId), session);
    });
    return outcome.average;
  }

  /**
   * Inside the caller's transaction (also used by the admin moderation
   * handler with the admin action's session). Writing the hotel document is what
   * serializes concurrent reviews of the same hotel: the second one hits a
   * write conflict, is retried, and then sees the first review.
   */
  async recomputeRating(
    hotelId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const [summary] = await this.reviews
      .aggregate<{ avg: number }>([
        { $match: { hotelId, isHidden: { $ne: true } } },
        { $group: { _id: null, avg: { $avg: '$rating' } } },
      ])
      .session(session ?? null)
      .exec();
    const average = summary ? roundRating(summary.avg) : 0;

    await this.connection
      .collection(PROVIDER_COLLECTIONS.hotel)
      .updateOne({ _id: hotelId }, { $set: { averageRating: average } }, { session });
    return average;
  }

  private async reviewerNames(
    userIds: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.map(String))].map((id) => this.oid(id));
    if (ids.length === 0) return new Map();
    // User schema fields: name and status. Only a deactivated account (or a
    // user that no longer exists) is shown as "Deleted user"; suspended
    // accounts keep their name.
    const users = await this.connection
      .collection(USERS_COLLECTION)
      .find({ _id: { $in: ids } }, { projection: { name: 1, status: 1 } })
      .toArray();
    return new Map(
      users.map((user) => [
        String(user._id),
        user.status === AccountStatus.DEACTIVATED
          ? DELETED_USER
          : String(user.name ?? DELETED_USER),
      ]),
    );
  }

  private assertValid(rating: number | undefined, comment: string | null) {
    const problem = reviewInputError(rating, comment);
    if (problem) throw new BadRequestException(problem);
  }

  private oid(id: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException('Not found');
    return new Types.ObjectId(id);
  }

  /** Only the owner's reservation; anyone else's is "not found" (ACC-11). */
  private async findOwnBooking(
    userId: string,
    bookingId: string,
  ): Promise<HotelBookingDocument> {
    const booking =
      Types.ObjectId.isValid(bookingId) && Types.ObjectId.isValid(userId)
        ? await this.bookings
            .findOne({ _id: this.oid(bookingId), userId: this.oid(userId) })
            .exec()
        : null;
    if (!booking) throw new NotFoundException('Hotel booking not found');
    return booking;
  }

  private toMine(review: ReviewDocument): MyReview {
    return {
      id: String(review._id),
      bookingId: String(review.bookingId),
      hotelId: String(review.hotelId),
      rating: review.rating,
      comment: review.comment ?? null,
      isHidden: review.isHidden === true,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    };
  }
}