import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { REFERENCE_COLLECTIONS } from '../reference-data.constants';

export type AttractionDocument = HydratedDocument<Attraction>;

@Schema({ timestamps: true, collection: REFERENCE_COLLECTIONS.attractions })
export class Attraction {
  // attraction_id from Attractions.csv, e.g. "att-1"
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, ref: 'City', required: true, trim: true })
  cityId: string;

  createdAt: Date;
  updatedAt: Date;
}

export const AttractionSchema = SchemaFactory.createForClass(Attraction);

AttractionSchema.index({ cityId: 1 });
