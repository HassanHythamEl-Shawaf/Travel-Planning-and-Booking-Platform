import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import type { ProviderType } from '../../auth/decorators/provider-ownership.decorator';
import { User } from '../../users/schemas/user.schema';

export const PROVIDER_TYPES: readonly ProviderType[] = ['airline', 'hotel'];

/**
 * Links a moderator account to exactly one airline or hotel (ACC-13).
 * Assignments are permanent: to move a moderator, suspend the account and
 * create a new one.
 */
@Schema({ timestamps: true, collection: 'moderatorassignments' })
export class ModeratorAssignment {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, unique: true })
  moderatorId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: PROVIDER_TYPES })
  providerType: ProviderType;

  @Prop({ type: Types.ObjectId, required: true })
  providerId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: User.name, required: true })
  assignedBy: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

export type ModeratorAssignmentDocument = HydratedDocument<ModeratorAssignment>;

export const ModeratorAssignmentSchema =
  SchemaFactory.createForClass(ModeratorAssignment);

ModeratorAssignmentSchema.index({ providerType: 1, providerId: 1 });
