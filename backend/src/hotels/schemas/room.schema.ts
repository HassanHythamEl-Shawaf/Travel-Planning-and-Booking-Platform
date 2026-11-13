import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomDocument = Room & Document;

@Schema({ timestamps: true })
export class Room {
  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId; // Links this room to the specific hotel

  @Prop({ required: true, trim: true })
  name: string; // e.g., "Deluxe Ocean View", "Standard Twin"

  @Prop({ required: true })
  pricePerNight: number;

  @Prop({ type: Object, required: true })
  occupancy: {
    maxAdults: number;
    maxChildren: number;
  }; // Seif (Person 6) needs this to validate guest counts for bookings

  @Prop({ type: [String], default: [] })
  amenities: string[];

  // We will handle availability dates and blocked dates in a separate RoomAvailability schema 
  // or via methods to keep this clean, as requested by the architecture.
}

export const RoomSchema = SchemaFactory.createForClass(Room);