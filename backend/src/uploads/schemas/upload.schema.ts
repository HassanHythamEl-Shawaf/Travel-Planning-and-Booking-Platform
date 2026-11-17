import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import {
  IMAGE_TYPES,
  UPLOAD_OWNER_TYPES,
  type UploadOwnerType,
} from '../uploads.constants';

/**
 * One stored image file (GEN-08). The file itself is on disk under
 * UPLOAD_DIR; this record lets us delete by id, look up the content type
 * when serving it, and count the images of an item.
 */
@Schema({
  collection: 'uploads',
  timestamps: { createdAt: true, updatedAt: false },
})
export class Upload {
  @Prop({ type: String, enum: UPLOAD_OWNER_TYPES, required: true })
  ownerType: UploadOwnerType;

  /** Id of the post, activity, hotel or airline the image belongs to. */
  @Prop({ type: String, required: true })
  ownerId: string;

  /** The user who uploaded it, when the caller knows it. */
  @Prop({ type: String, default: null })
  uploaderId: string | null;

  /** Random UUID + extension. Never the client's original file name. */
  @Prop({ type: String, required: true, unique: true })
  fileName: string;

  @Prop({ type: String, enum: Object.values(IMAGE_TYPES), required: true })
  mimeType: string;

  /** Size in bytes. */
  @Prop({ type: Number, required: true, min: 1 })
  size: number;

  /** Where the file is served, e.g. /api/uploads/<uuid>.jpg */
  @Prop({ type: String, required: true })
  url: string;

  createdAt: Date;
}

export type UploadDocument = HydratedDocument<Upload>;

export const UploadSchema = SchemaFactory.createForClass(Upload);

UploadSchema.index({ ownerType: 1, ownerId: 1 });
