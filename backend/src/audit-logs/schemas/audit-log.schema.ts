import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

import { User } from '../../users/schemas/user.schema';
import { AuditAction, AuditTargetType } from '../audit-log.constants';

/**
 * Append-only record of an administrative action (GEN-07). There are no
 * update or delete code paths. `details` must never contain passwords or tokens.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  actorId: Types.ObjectId;

  @Prop({ type: String, enum: AuditAction, required: true, index: true })
  action: AuditAction;

  @Prop({ type: String, enum: AuditTargetType, required: true })
  targetType: AuditTargetType;

  @Prop({ type: String, required: true })
  targetId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  details: Record<string, unknown>;

  createdAt: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1 });
