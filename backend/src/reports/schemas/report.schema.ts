import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import {
  CONTENT_TYPES,
  type ContentType,
} from '../../moderation/moderation.types';
import { User } from '../../users/schemas/user.schema';
import {
  REPORT_DETAILS_MAX,
  ReportReason,
  ReportStatus,
} from '../report.constants';

/**
 * What the content looked like when it was reported (D11), so the report
 * stays readable after the content is edited or deleted.
 */
@Schema({ _id: false })
export class ReportSnapshot {
  @Prop({ type: String })
  title?: string;

  @Prop({ type: String, default: '' })
  excerpt: string;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  authorId: Types.ObjectId;
}

const ReportSnapshotSchema = SchemaFactory.createForClass(ReportSnapshot);

/** A user's report of a post, comment, review or itinerary (GEN-09). */
@Schema({ timestamps: true, collection: 'reports' })
export class Report {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: CONTENT_TYPES, required: true })
  targetType: ContentType;

  @Prop({ type: Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  @Prop({ type: String, enum: ReportReason, required: true })
  reason: ReportReason;

  @Prop({ type: String, default: null, maxlength: REPORT_DETAILS_MAX })
  details: string | null;

  @Prop({
    type: String,
    enum: ReportStatus,
    default: ReportStatus.OPEN,
    required: true,
  })
  status: ReportStatus;

  @Prop({ type: ReportSnapshotSchema, required: true })
  snapshot: ReportSnapshot;

  @Prop({ type: Types.ObjectId, ref: User.name, default: null })
  resolvedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null;

  @Prop({ type: String, default: null, maxlength: REPORT_DETAILS_MAX })
  resolutionNote: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ReportDocument = HydratedDocument<Report>;

export const ReportSchema = SchemaFactory.createForClass(Report);

// One OPEN report per user per item (D5); after resolution they may report again.
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true, partialFilterExpression: { status: ReportStatus.OPEN } },
);
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ reporterId: 1, createdAt: -1 });
