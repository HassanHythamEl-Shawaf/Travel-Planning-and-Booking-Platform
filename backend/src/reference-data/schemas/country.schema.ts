import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { REFERENCE_COLLECTIONS } from '../reference-data.constants';

export type CountryDocument = HydratedDocument<Country>;

@Schema({ timestamps: true, collection: REFERENCE_COLLECTIONS.countries })
export class Country {
  // ISO 3166-1 alpha-2 code from Countries.csv, e.g. "EG"
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  // ISO 4217 code, e.g. "EGP"
  @Prop({ required: true, trim: true })
  currency: string;

  createdAt: Date;
  updatedAt: Date;
}

export const CountrySchema = SchemaFactory.createForClass(Country);
