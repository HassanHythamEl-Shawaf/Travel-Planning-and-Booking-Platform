import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RoomAvailabilityDocument = RoomAvailability & Document;

@Schema({ timestamps: true })
export class RoomAvailability {
  @Prop({ type: Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true })
  startDate: Date;

  @Prop({ required: true })
  endDate: Date;

  @Prop({ required: true, enum: ['booked', 'maintenance'], default: 'booked' })
  status: string;

  // This will eventually link to the booking created by Person 6
  @Prop({ type: String, required: false })
  bookingReference?: string; 
}

export const RoomAvailabilitySchema = SchemaFactory.createForClass(RoomAvailability);