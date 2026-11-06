import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import {
  CONTENT_COLLECTIONS,
  POST_STATUS,
} from '../../integrations/teammate-contracts';
import { User } from '../../users/schemas/user.schema';
import {
  POST_CONTENT_MAX,
  POST_STATUSES,
  POST_TITLE_MAX,
  POST_TITLE_MIN,
  type PostStatus,
} from '../blog.constants';

/** An image attached through the shared upload module (BLG-10, GEN-08). */
@Schema({ _id: false })
export class PostImage {
  @Prop({ type: String, required: true })
  imageId: string;

  @Prop({ type: String, required: true })
  url: string;
}

const PostImageSchema = SchemaFactory.createForClass(PostImage);

/**
 * A blog post (BLG-01). Field and collection names are fixed by
 * integrations/teammate-contracts.ts because the moderation code reads them.
 */
@Schema({ timestamps: true, collection: CONTENT_COLLECTIONS.post })
export class Post {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    minlength: POST_TITLE_MIN,
    maxlength: POST_TITLE_MAX,
  })
  title: string;

  /** Stored as written (plain text or markdown); the frontend renders it as text. */
  @Prop({ type: String, required: true, minlength: 1, maxlength: POST_CONTENT_MAX })
  content: string;

  @Prop({
    type: String,
    enum: POST_STATUSES,
    default: POST_STATUS.DRAFT,
    required: true,
  })
  status: PostStatus;

  /** Set on the first publish and never changed afterwards (D3). */
  @Prop({ type: Date, default: null })
  publishedAt: Date | null;

  /** Normalised: lowercase, deduplicated, max 5 (BLG-08). */
  @Prop({ type: [String], default: [] })
  tags: string[];

  /** The first image is the cover. */
  @Prop({ type: [PostImageSchema], default: [] })
  images: PostImage[];

  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  /** Non-hidden comments only (D7). */
  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type PostDocument = HydratedDocument<Post>;

export const PostSchema = SchemaFactory.createForClass(Post);

PostSchema.index({ status: 1, isHidden: 1, publishedAt: -1 });
PostSchema.index({ tags: 1 });
PostSchema.index({ authorId: 1, updatedAt: -1 });
