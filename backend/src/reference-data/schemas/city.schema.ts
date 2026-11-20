import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { REFERENCE_COLLECTIONS } from '../reference-data.constants';

export type CityDocument = HydratedDocument<City>;

@Schema({ timestamps: true, collection: REFERENCE_COLLECTIONS.cities })
export class City {
  // city_id from Cities.csv, e.g. "cairo"
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, ref: 'Country', required: true, trim: true })
  countryCode: string;

  createdAt: Date;
  updatedAt: Date;
}

export const CitySchema = SchemaFactory.createForClass(City);

CitySchema.index({ countryCode: 1 });
