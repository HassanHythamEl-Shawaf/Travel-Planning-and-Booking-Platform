import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export enum UserRole {
  USER = 'user',
  ADMIN = 'admin',
  MODERATOR = 'moderator',
}

export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({
    required: true,
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Prop({
    required: true,
    enum: AccountStatus,
    default: AccountStatus.ACTIVE,
  })
  status: AccountStatus;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  preferredCurrency?: string;

  @Prop({ required: true })
  termsAcceptedAt: Date;

  @Prop({ required: true })
  privacyPolicyAcceptedAt: Date;

  @Prop({ default: 0, min: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockUntil: Date | null;

  @Prop({
    type: String,
    default: null,
    select: false,
  })
  refreshTokenHash: string | null;

  @Prop({ type: Date, default: null })
  lastActivityAt: Date | null;

  @Prop({ default: false })
  mustChangePassword: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);