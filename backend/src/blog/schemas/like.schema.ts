import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { CONTENT_COLLECTIONS } from '../../integrations/teammate-contracts';
import { User } from '../../users/schemas/user.schema';

/** One user's like of one post (BLG-06). */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: CONTENT_COLLECTIONS.like,
})
export class Like {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  userId: Types.ObjectId;

  createdAt: Date;
}

export type LikeDocument = HydratedDocument<Like>;

export const LikeSchema = SchemaFactory.createForClass(Like);

// At most one like per user per post (D13).
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
