import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AirlineDocument = HydratedDocument<Airline>;

export class BaggagePolicy {
  @Prop({ required: true, min: 0.01 })
  pricePerExtraBag: number;

  @Prop({ required: true, min: 0 })
  maxExtraBagsPerPassenger: number;
}

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

  @Prop({
    type: {
      pricePerExtraBag: { type: Number, required: true, min: 0.01 },
      maxExtraBagsPerPassenger: { type: Number, required: true, min: 0 },
    },
    default: null,
  })
  baggagePolicy: BaggagePolicy | null;

  createdAt: Date;
  updatedAt: Date;
}

export const AirlineSchema = SchemaFactory.createForClass(Airline);
