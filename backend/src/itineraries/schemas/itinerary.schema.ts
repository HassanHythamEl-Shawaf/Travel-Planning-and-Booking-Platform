import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { CONTENT_COLLECTIONS } from '../../integrations/teammate-contracts';
import { User } from '../../users/schemas/user.schema';
import {
  ACTIVITY_DESCRIPTION_MAX,
  ACTIVITY_NAME_MAX,
  BUDGET_CATEGORIES,
  type BudgetCategory,
  DAY_NOTES_MAX,
  ENTRY_NOTE_MAX,
  ITINERARY_TITLE_MAX,
  TRANSPORT_MODES,
  type TransportMode,
} from '../itineraries.constants';

/** An image attached through the shared upload module (ITN-12, GEN-08). */
@Schema({ _id: false })
export class ActivityImage {
  @Prop({ type: String, required: true })
  imageId: string;

  @Prop({ type: String, required: true })
  url: string;
}
const ActivityImageSchema = SchemaFactory.createForClass(ActivityImage);

/** ITN-10: an activity of a day. Its cost counts under "activities". */
@Schema()
export class Activity {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, maxlength: ACTIVITY_NAME_MAX })
  name: string;

  @Prop({ type: String, default: '', maxlength: ACTIVITY_DESCRIPTION_MAX })
  description: string;

  /** Optional local time "HH:mm". */
  @Prop({ type: String, default: null })
  time: string | null;

  /** Optional cost; set together with currency. */
  @Prop({ type: Number, default: null, min: 0 })
  cost: number | null;

  @Prop({ type: String, default: null })
  currency: string | null;

  @Prop({ type: [ActivityImageSchema], default: [] })
  images: ActivityImage[];
}
const ActivitySchema = SchemaFactory.createForClass(Activity);

/** ITN-14: a budget entry of a day. */
@Schema()
export class BudgetEntry {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: BUDGET_CATEGORIES, required: true })
  category: BudgetCategory;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: String, default: '', maxlength: ENTRY_NOTE_MAX })
  note: string;
}
const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

/**
 * ITN-05: one day. Its number and date are not stored: they come from its
 * position in `days` and the itinerary's start date (spec D4).
 */
@Schema()
export class Day {
  /** Stable id, so transport entries stay on the right day after a move. */
  _id: Types.ObjectId;

  /** City id from the reference data, e.g. "cairo" (ITN-09: required). */
  @Prop({ type: String, required: true })
  cityId: string;

  @Prop({ type: String, default: '', maxlength: DAY_NOTES_MAX })
  notes: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgetEntries: BudgetEntry[];
}
const DaySchema = SchemaFactory.createForClass(Day);

/** ITN-16: an intercity transport cost, attached to a day by its id. */
@Schema()
export class TransportEntry {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  @Prop({ type: String, enum: TRANSPORT_MODES, required: true })
  mode: TransportMode;

  @Prop({ type: String, required: true })
  fromCityId: string;

  @Prop({ type: String, required: true })
  toCityId: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({ type: String, default: '', maxlength: ENTRY_NOTE_MAX })
  note: string;
}
const TransportEntrySchema = SchemaFactory.createForClass(TransportEntry);

/** ITN-21: who and what a clone was copied from. */
@Schema({ _id: false })
export class ClonedFrom {
  @Prop({ type: Types.ObjectId, required: true })
  itineraryId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  /** The author's name when the clone was made. */
  @Prop({ type: String, required: true })
  authorName: string;
}
const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

/**
 * A travel itinerary (ITN-01). The model name, collection and the fields
 * ownerId, title, isPublic, isHidden, countries and createdAt are fixed by
 * ITINERARY_FIELDS in integrations/teammate-contracts.ts, because Blog's
 * author page and the moderation code read them.
 */
@Schema({ timestamps: true, collection: CONTENT_COLLECTIONS.itinerary })
export class Itinerary {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: ITINERARY_TITLE_MAX,
  })
  title: string;

  /** Country codes from the reference data, e.g. ["EG"]. At least one. */
  @Prop({ type: [String], required: true })
  countries: string[];

  /** Day 1's date, stored as midnight UTC. */
  @Prop({ type: Date, required: true })
  startDate: Date;

  /** ITN-01: private by default. */
  @Prop({ type: Boolean, default: false })
  isPublic: boolean;

  /** GEN-10: hidden by an admin; visible only to the owner and admins. */
  @Prop({ type: Boolean, default: false })
  isHidden: boolean;

  /** In order: day 1 first. At most 60. */
  @Prop({ type: [DaySchema], default: [] })
  days: Day[];

  @Prop({ type: [TransportEntrySchema], default: [] })
  transportEntries: TransportEntry[];

  @Prop({ type: ClonedFromSchema, default: null })
  clonedFrom: ClonedFrom | null;

  /** Increased on every change to days or entries (spec D9). */
  @Prop({ type: Number, default: 0 })
  version: number;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;

export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// Public search (ITN-21) and "my itineraries" (ITN-03).
ItinerarySchema.index({ isPublic: 1, isHidden: 1, createdAt: -1 });
ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });

/** A lean itinerary as read from the database (fields may be missing). */
export type LeanItinerary = Partial<Itinerary> & {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  title: string;
};
