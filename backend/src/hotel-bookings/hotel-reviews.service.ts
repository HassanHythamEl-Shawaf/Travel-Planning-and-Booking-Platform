import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import type { ClientSession } from 'mongoose';

import { PROVIDER_COLLECTIONS } from '../integrations/teammate-contracts';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { HotelBookingStatus } from './hotel-booking-status';
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

@Injectable()
export class HotelReviewsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Review.name)
    private readonly reviews: Model<ReviewDocument>,
    @InjectConnection() private readonly connection: Connection,
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