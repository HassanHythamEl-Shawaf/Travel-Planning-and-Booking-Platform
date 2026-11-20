import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { CONTENT_COLLECTIONS } from '../../integrations/teammate-contracts';
import { User } from '../../users/schemas/user.schema';
import { COMMENT_MAX } from '../blog.constants';

/** A flat comment on a post (BLG-05, D11). */
@Schema({ timestamps: true, collection: CONTENT_COLLECTIONS.comment })
export class Comment {
  @Prop({ type: Types.ObjectId, ref: 'Post', required: true })
  postId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: 1,
    maxlength: COMMENT_MAX,
  })
  content: string;

  /** Set when the author edits the comment (BLG-07). */
  @Prop({ type: Date, default: null })
  editedAt: Date | null;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ postId: 1, createdAt: 1 });
CommentSchema.index({ authorId: 1 });
