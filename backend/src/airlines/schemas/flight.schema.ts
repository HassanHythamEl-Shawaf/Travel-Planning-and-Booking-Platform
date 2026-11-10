import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum FlightStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled',
  DEPARTED = 'Departed',
}

export type FlightDocument = HydratedDocument<Flight>;

@Schema({ timestamps: true })
export class Flight {
  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  flightNumber: string;

  @Prop({ required: true, uppercase: true, trim: true })
  departureAirportCode: string;

  @Prop({ required: true, uppercase: true, trim: true })
  arrivalAirportCode: string;

  @Prop({ required: true, type: Date })
  departureAt: Date;

  @Prop({ required: true, type: Date })
  arrivalAt: Date;

  @Prop({ required: true, trim: true })
  departureTimeZone: string;

  @Prop({ required: true, trim: true })
  arrivalTimeZone: string;

  @Prop({ required: true, trim: true })
  departureLocalDate: string;

  @Prop({ required: true, enum: FlightStatus, default: FlightStatus.SCHEDULED })
  status: FlightStatus;

  createdAt: Date;
  updatedAt: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);
