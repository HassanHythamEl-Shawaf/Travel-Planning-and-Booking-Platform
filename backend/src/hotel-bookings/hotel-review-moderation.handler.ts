import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { ModerationRegistry } from '../moderation/moderation.registry';
import type { ModerationHandler } from '../moderation/moderation.types';
import { HotelReviewsService } from './hotel-reviews.service';
import { Review, ReviewDocument } from './schemas/review.schema';

const EXCERPT_LENGTH = 200;

/**
 * GEN-09 / GEN-10 for hotel reviews: replaces the default raw-collection
 * handler, so hiding, unhiding or deleting a review keeps the hotel's average
 * rating right. Every write uses the admin action's transaction session, and
 * nothing is sent from here (notifications come after the commit).
 */
@Injectable()
export class HotelReviewModerationHandler implements OnModuleInit {
  constructor(
    private readonly registry: ModerationRegistry,
    @InjectModel(Review.name) private readonly reviews: Model<ReviewDocument>,
    private readonly ratings: HotelReviewsService,
  ) {}

  onModuleInit(): void {
    this.registry.register('review', this.handler());
  }

  handler(): ModerationHandler {
    return {
      find: async (id, session) => {
        if (!Types.ObjectId.isValid(id)) return null;
        const review = await this.reviews
          .findById(id)
          .session(session ?? null)
          .lean()
          .exec();
        if (!review) return null;
        const hidden = review.isHidden === true;
        return {
          id,
          type: 'review',
          authorId: String(review.userId),
          isHidden: hidden,
          publiclyVisible: !hidden,
          snapshot: { excerpt: (review.comment ?? '').slice(0, EXCERPT_LENGTH) },
        };
      },

      // Conditional on the current state, so a repeat changes nothing.
      setHidden: async (id, hidden, session) => {
        if (!Types.ObjectId.isValid(id)) return false;
        const changed = await this.reviews
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(id),
              isHidden: hidden ? { $ne: true } : true,
            },
            { $set: { isHidden: hidden } },
            { returnDocument: 'after', session },
          )
          .exec();
        if (!changed) return false;
        await this.ratings.recomputeRating(changed.hotelId, session);
        return true;
      },

      delete: async (id, session) => {
        if (!Types.ObjectId.isValid(id)) return false;
        const removed = await this.reviews
          .findOneAndDelete({ _id: new Types.ObjectId(id) }, { session })
          .exec();
        if (!removed) return false;
        await this.ratings.recomputeRating(removed.hotelId, session);
        return true;
      },
    };
  }
}