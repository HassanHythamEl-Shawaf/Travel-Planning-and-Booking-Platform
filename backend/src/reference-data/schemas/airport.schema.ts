import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { REFERENCE_COLLECTIONS } from '../reference-data.constants';

export type AirportDocument = HydratedDocument<Airport>;

@Schema({ timestamps: true, collection: REFERENCE_COLLECTIONS.airports })
export class Airport {
  // IATA code from Airports.csv, e.g. "CAI"
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, ref: 'City', required: true, trim: true })
  cityId: string;

  @Prop({ type: String, ref: 'Country', required: true, trim: true })
  countryCode: string;

  // IANA time zone, e.g. "Africa/Cairo"
  @Prop({ required: true, trim: true })
  timeZone: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AirportSchema = SchemaFactory.createForClass(Airport);

AirportSchema.index({ cityId: 1 });
