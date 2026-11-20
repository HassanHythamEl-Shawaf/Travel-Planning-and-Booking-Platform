import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true })
export class Room {
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, trim: true, default: 'Standard' })
  type: string;

  @Prop({ required: true, min: 1, default: 1 })
  beds: number;

  @Prop({ required: true, min: 0.01 })
  pricePerNight: number;

  @Prop({ type: Object, required: true })
  occupancy: {
    maxAdults: number;
    maxChildren: number;
  };

  @Prop({ type: [String], default: [] })
  amenities: string[];

  @Prop({ default: true })
  isActive: boolean;
}

export const RoomSchema = SchemaFactory.createForClass(Room);