import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

@Schema({ timestamps: true })
export class Airline {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string;

  @Prop({ type: String, default: null })
  logoUrl: string | null;

  @Prop({ required: true, default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
