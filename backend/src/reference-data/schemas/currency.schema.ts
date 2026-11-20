import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { REFERENCE_COLLECTIONS } from '../reference-data.constants';

export type CurrencyDocument = HydratedDocument<Currency>;

// Supported currencies are derived from the currency column of Countries.csv.
@Schema({ timestamps: true, collection: REFERENCE_COLLECTIONS.currencies })
export class Currency {
  // ISO 4217 code, e.g. "EUR"
  @Prop({ type: String, required: true })
  _id: string;

  // Countries using this currency, sorted A-Z, e.g. ["DE", "FR"]
  @Prop({ type: [String], required: true })
  countryCodes: string[];

  createdAt: Date;
  updatedAt: Date;
}

export const CurrencySchema = SchemaFactory.createForClass(Currency);
