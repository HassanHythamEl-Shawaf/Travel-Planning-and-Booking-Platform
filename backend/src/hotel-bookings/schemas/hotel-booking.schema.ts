import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { PLATFORM_CURRENCY } from '../../flight-bookings/flight-booking.constants';
import {
  HOTEL_BOOKING_STATUSES,
  HotelBookingStatus,
} from '../hotel-booking-status';

/**
 * One reserved room. Name and price are copied when the booking is created,
 * so later price edits do not change what the guest agreed to pay (HTL-16).
 */
@Schema({ _id: false })
export class HotelBookedRoom {
  @Prop({ type: Types.ObjectId, required: true })
  roomId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  roomName: string;

  /** Room price per night at booking time. */
  @Prop({ required: true, min: 0 })
  pricePerNight: number;

  @Prop({ required: true, min: 0 })
  adults: number;

  /** Age (0-17) of each child. */
  @Prop({ type: [Number], default: [] })
  childrenAges: number[];

  /** nights x pricePerNight. */
  @Prop({ required: true, min: 0 })
  subtotal: number;
}

export const HotelBookedRoomSchema =
  SchemaFactory.createForClass(HotelBookedRoom);

/**
 * The hotel's cancellation terms when the rooms were held, so the refund
 * follows the policy the guest saw and accepted, not a later edit (HTL-21).
 */
@Schema({ _id: false })
export class HotelCancellationPolicy {
  @Prop({ required: true, min: 0 })
  freeCancellationHours: number;

  @Prop({ required: true, min: 0, max: 100 })
  refundPercentageAfterDeadline: number;

  /** "HH:mm" check-in time of the hotel. */
  @Prop({ required: true, default: '14:00' })
  checkInTime: string;

  @Prop({ default: '' })
  description: string;
}

export const HotelCancellationPolicySchema = SchemaFactory.createForClass(
  HotelCancellationPolicy,
);

export type HotelBookingDocument = HydratedDocument<HotelBooking>;

/**
 * Hotel booking. Stored in the `hotelbookings` collection, whose top-level
 * field names are part of the team contract read by admin booking inspection
 * (integrations/teammate-contracts.ts): userId, status, createdAt,
 * bookingReference, totalPrice, currency, hotelId, checkInDate.
 */
@Schema({ timestamps: true })
export class HotelBooking {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  hotelName: string;

  /** Calendar dates stored as UTC midnights. */
  @Prop({ required: true, type: Date })
  checkInDate: Date;

  @Prop({ required: true, type: Date })
  checkOutDate: Date;

  @Prop({ required: true, min: 1 })
  nights: number;

  @Prop({
    type: [HotelBookedRoomSchema],
    required: true,
    validate: {
      validator(rooms: HotelBookedRoom[]) {
        return (
          rooms.length >= 1 && rooms.reduce((n, r) => n + r.adults, 0) >= 1
        );
      },
      message: 'A reservation needs at least one room and one adult',
    },
  })
  rooms: HotelBookedRoom[];

  /** Sum over rooms of nights x price at booking time. */
  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ required: true, default: PLATFORM_CURRENCY })
  currency: string;

  /** Snapshot taken at hold time (null only for bookings that predate it). */
  @Prop({ type: HotelCancellationPolicySchema, default: null })
  cancellationPolicy: HotelCancellationPolicy | null;

  @Prop({
    type: String,
    required: true,
    enum: HOTEL_BOOKING_STATUSES,
    default: HotelBookingStatus.PENDING_PAYMENT,
  })
  status: HotelBookingStatus;

  /** End of the 10-minute Pending Payment hold (HTL-18); null once settled. */
  @Prop({ type: Date, default: null })
  holdExpiresAt: Date | null;

  /** Generated at confirmation; null before. */
  @Prop({ type: String, default: null })
  bookingReference: string | null;

  /** Stripe PaymentIntent that paid this booking; set at confirmation (PAY-03 refunds). */
  @Prop({ type: String, default: null })
  paymentIntentId: string | null;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: Number, min: 0, max: 100, default: null })
  refundPercentage: number | null;

  @Prop({ type: Number, min: 0, default: null })
  refundAmount: number | null;

  @Prop({ type: String, default: null })
  refundId: string | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

// HTL-20: a user's bookings, newest first.
HotelBookingSchema.index({ userId: 1, createdAt: -1 });
// HTL-22 / overlap checks: bookings of one hotel by stay and status.
HotelBookingSchema.index({ hotelId: 1, checkInDate: 1, status: 1 });
// Expiry job : Pending Payment holds past their expiry.
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// References are unique once issued; unconfirmed bookings hold null.
HotelBookingSchema.index(
  { bookingReference: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingReference: { $type: 'string' } },
  },
);