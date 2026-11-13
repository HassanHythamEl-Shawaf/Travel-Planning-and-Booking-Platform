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
  photos: string[]; // Reusable upload module integration (Hammad / Person 8)

  @Prop({ default: true })
  isActive: boolean; // Admin deactivation flag (Wael / Person 2)

  @Prop({ default: 0 })
  averageRating: number; // Updated by reviews (Seif / Person 6)

  @Prop({ type: Object, default: {} })
  policies: {
    cancellationPolicy?: string;
    checkInTime?: string;
    checkOutTime?: string;
  };
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);