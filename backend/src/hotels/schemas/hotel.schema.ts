import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HotelDocument = Hotel & Document;

@Schema({ timestamps: true })
export class Hotel {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  address: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  country: string;

  @Prop({ type: [String], default: [] })
  photos: string[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 0 })
  averageRating: number;

  @Prop({ default: '14:00' })
  checkInTime: string;

  @Prop({ default: '12:00' })
  checkOutTime: string;

  @Prop({
    type: {
      freeCancellationHours: { type: Number, default: 24 },
      refundPercentageAfterDeadline: { type: Number, default: 0 },
      description: {
        type: String,
        default: 'Free cancellation up to 24 hours before check-in.',
      },
    },
    default: () => ({
      freeCancellationHours: 24,
      refundPercentageAfterDeadline: 0,
      description: 'Free cancellation up to 24 hours before check-in.',
    }),
  })
  cancellationPolicy: {
    freeCancellationHours: number;
    refundPercentageAfterDeadline: number;
    description: string;
  };

  @Prop({ type: [String], default: [] })
  houseRules: string[];
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);