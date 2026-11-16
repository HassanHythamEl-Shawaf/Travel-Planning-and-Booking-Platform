import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * The exchange rates fetched on one day (ITN-18). At most one per day:
 * `day` is unique, so even two servers fetching at the same moment store
 * one snapshot.
 */
@Schema({ collection: 'fx_rate_snapshots' })
export class FxRateSnapshot {
  /** The UTC day it was fetched for, YYYY-MM-DD. */
  @Prop({ type: String, required: true, unique: true })
  day: string;

  @Prop({ type: String, required: true })
  base: string;

  /** The provider's rate date, YYYY-MM-DD (shown to users). */
  @Prop({ type: String, required: true })
  rateDate: string;

  /** 1 `base` = rates[code] `code`. */
  @Prop({ type: Object, required: true })
  rates: Record<string, number>;

  @Prop({ type: Date, required: true })
  fetchedAt: Date;
}

export type FxRateSnapshotDocument = HydratedDocument<FxRateSnapshot>;

export const FxRateSnapshotSchema =
  SchemaFactory.createForClass(FxRateSnapshot);
