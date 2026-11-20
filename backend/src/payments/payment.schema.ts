import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

export enum PaymentStatus {
  PENDING = 'Pending',
  SUCCEEDED = 'Succeeded',
  FAILED = 'Failed',
  CANCELLED = 'Cancelled',
  REFUNDED = 'Refunded',
}

@Schema({ timestamps: true })
export class Payment {
  @Prop({ required: true, enum: ['flight', 'hotel'] })
  bookingType: 'flight' | 'hotel';

  @Prop({ required: true })
  bookingId: string;

  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true })
  stripePaymentIntentId: string;

  @Prop({ required: true, min: 1 })
  amountMinor: number;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;

  @Prop({ required: true, enum: Object.values(PaymentStatus) })
  status: PaymentStatus;

  @Prop({ required: true, min: 0, default: 0 })
  attempt: number;

  @Prop({ type: Date, default: null })
  holdExpiresAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ bookingType: 1, bookingId: 1 }, { unique: true });

export type RefundDocument = HydratedDocument<Refund>;

export enum RefundStatus {
  PENDING = 'Pending',
  REFUNDED = 'Refunded',
  FAILED = 'Failed',
}

@Schema({ timestamps: true })
export class Refund {
  @Prop({ required: true, enum: ['flight', 'hotel'] })
  bookingType: 'flight' | 'hotel';

  @Prop({ required: true })
  bookingId: string;

  @Prop({
    required: true,
    enum: ['cancellation', 'late_payment'],
    default: 'cancellation',
  })
  reason: 'cancellation' | 'late_payment';

  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: String, default: null })
  stripePaymentIntentId: string | null;

  @Prop({ type: String, default: null })
  stripeRefundId: string | null;

  @Prop({ required: true, min: 1 })
  amountMinor: number;

  @Prop({ required: true, uppercase: true, minlength: 3, maxlength: 3 })
  currency: string;

  @Prop({ required: true, enum: Object.values(RefundStatus) })
  status: RefundStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index(
  { stripeRefundId: 1 },
  { unique: true, partialFilterExpression: { stripeRefundId: { $type: 'string' } } },
);
RefundSchema.index({ bookingType: 1, bookingId: 1, createdAt: -1 });
RefundSchema.index(
  { bookingType: 1, bookingId: 1, reason: 1 },
  { unique: true },
);
