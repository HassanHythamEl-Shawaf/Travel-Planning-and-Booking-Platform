import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export enum FlightStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled',
  DEPARTED = 'Departed',
}

export enum CabinCategory {
  ECONOMY = 'Economy',
  PREMIUM_ECONOMY = 'Premium Economy',
  BUSINESS = 'Business',
  FIRST = 'First',
}

@Schema({ _id: true })
export class Cabin {
  _id?: Types.ObjectId;
  @Prop({ required: true, enum: CabinCategory })
  category: CabinCategory;

  @Prop({ required: true, min: 1 })
  seatCount: number;

  @Prop({ required: true, min: 0 })
  price: number;

  @Prop({ required: true, min: 0 })
  freeBaggageAllowance: number;

  @Prop({ required: true, min: 0 })
  maxWeightPerBagKg: number;

  @Prop({ required: true, min: 0, default: 0 })
  seatsBooked?: number;

  @Prop({ required: true, min: 0, default: 0 })
  seatsHeld?: number;
}

export const CabinSchema = SchemaFactory.createForClass(Cabin);

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

  @Prop({ type: [CabinSchema], default: [] })
  cabins: Cabin[];

  createdAt: Date;
  updatedAt: Date;
}

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);
