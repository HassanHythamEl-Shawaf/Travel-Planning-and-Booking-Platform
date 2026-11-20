import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum InventoryHoldStatus {
  HELD = 'Held',
  CONFIRMED = 'Confirmed',
  RELEASED = 'Released',
}

export type FlightInventoryHoldDocument = HydratedDocument<FlightInventoryHold>;

@Schema({ timestamps: true })
export class FlightInventoryHold {
  @Prop({ required: true, unique: true, trim: true })
  holdId: string;

  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  cabinId: Types.ObjectId;

  @Prop({ required: true, min: 1 })
  seats: number;

  @Prop({ required: true, enum: InventoryHoldStatus })
  status: InventoryHoldStatus;

  @Prop({ required: true, type: Date })
  expiresAt: Date;
}

export const FlightInventoryHoldSchema =
  SchemaFactory.createForClass(FlightInventoryHold);

FlightInventoryHoldSchema.index({ expiresAt: 1, status: 1 });
