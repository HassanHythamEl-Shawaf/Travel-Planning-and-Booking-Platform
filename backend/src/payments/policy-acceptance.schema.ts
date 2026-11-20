import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;

@Schema({ timestamps: true })
export class PolicyAcceptance {
  @Prop({ type: String, required: true })
  bookingType: 'flight' | 'hotel';

  @Prop({ type: String, required: true })
  bookingId: string;

  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, default: 'v1' })
  policyVersion: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  acceptedAt: Date;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  policySnapshot: Record<string, unknown>;
}

export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index(
  { bookingType: 1, bookingId: 1, userId: 1 },
  { unique: true },
);
