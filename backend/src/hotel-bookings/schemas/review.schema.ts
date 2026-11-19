import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { MAX_COMMENT_LENGTH, MAX_RATING, MIN_RATING } from '../review-rules';

export type ReviewDocument = HydratedDocument<Review>;

/**
 * Hotel review (HTL-23). Stored in the `reviews` collection, whose top-level
 * field names are part of the team contract read by admin moderation
 * (integrations/teammate-contracts.ts): userId, hotelId, comment, isHidden.
 * One review per reservation, whatever its number of rooms.
 */
@Schema({ timestamps: true })
export class Review {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'HotelBooking', required: true })
  bookingId: Types.ObjectId;

  @Prop({
    required: true,
    min: MIN_RATING,
    max: MAX_RATING,
    validate: { validator: Number.isInteger, message: 'rating must be a whole number' },
  })
  rating: number;

  @Prop({ type: String, trim: true, maxlength: MAX_COMMENT_LENGTH, default: null })
  comment: string | null;

  /** Admin moderation: hidden reviews are left out of lists and the average. */
  @Prop({ default: false })
  isHidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);

// One review per reservation (deleting it frees the reservation to be reviewed again).
ReviewSchema.index({ bookingId: 1 }, { unique: true });
// Hotel review list, newest first, and the average over visible reviews.
ReviewSchema.index({ hotelId: 1, isHidden: 1, createdAt: -1 });