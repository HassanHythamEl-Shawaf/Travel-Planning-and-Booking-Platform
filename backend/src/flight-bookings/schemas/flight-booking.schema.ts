import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { CabinCategory } from '../../airlines/schemas/flight.schema';
import {
  CancellationSource,
  MAX_PASSENGERS_PER_BOOKING,
  PassengerType,
  PLATFORM_CURRENCY,
  SegmentDirection,
  TripType,
} from '../flight-booking.constants';
import {
  FLIGHT_BOOKING_STATUSES,
  FlightBookingStatus,
} from '../flight-booking-status';
import { compositionError, countPassengers } from '../passenger-rules';

/**
 * One flight of the trip. Flight, cabin, fare and baggage rules are copied
 * when the booking is created, so later schedule or price edits (FLT-05) do
 * not change what the passenger agreed to pay.
 */
@Schema({ _id: false })
export class FlightSegment {
  @Prop({ type: String, required: true, enum: SegmentDirection })
  direction: SegmentDirection;

  @Prop({ type: Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  flightNumber: string;

  @Prop({ required: true, trim: true, uppercase: true })
  departureAirportCode: string;

  @Prop({ required: true, trim: true, uppercase: true })
  arrivalAirportCode: string;

  /** UTC instant; shown in departureTimeZone (GEN-06). */
  @Prop({ required: true, type: Date })
  departureAt: Date;

  @Prop({ required: true, type: Date })
  arrivalAt: Date;

  @Prop({ required: true, trim: true })
  departureTimeZone: string;

  @Prop({ required: true, trim: true })
  arrivalTimeZone: string;

  @Prop({ type: Types.ObjectId, required: true })
  cabinId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: CabinCategory })
  cabinCategory: CabinCategory;

  /** Cabin price per seat-occupying passenger at booking time. */
  @Prop({ required: true, min: 0 })
  cabinFare: number;

  @Prop({ required: true, min: 0 })
  freeBaggageAllowance: number;

  /** Applies to free and extra bags alike (FLT-08). */
  @Prop({ required: true, min: 0 })
  maxWeightPerBagKg: number;

  @Prop({ required: true, min: 0, default: 0 })
  pricePerExtraBag: number;

  @Prop({ required: true, min: 0, default: 0 })
  maxExtraBagsPerPassenger: number;

  /** Seats held/booked on this flight: adults + children (infants sit on laps). */
  @Prop({ required: true, min: 1 })
  seats: number;

  /** Inventory hold from Person 3's FlightInventoryService.createHold(). */
  @Prop({ type: String, default: null })
  holdId: string | null;
}

export const FlightSegmentSchema = SchemaFactory.createForClass(FlightSegment);

/**
 * FLT-19 passenger. Keeps its own _id so moderator views (FLT-29) can list
 * passengers individually. Extra bags apply to every segment of the trip.
 */
@Schema({ _id: true })
export class FlightPassenger {
  _id?: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  fullName: string;

  @Prop({ required: true, type: Date })
  dateOfBirth: Date;

  /** Passport or national ID number. */
  @Prop({
    required: true,
    trim: true,
    uppercase: true,
    minlength: 3,
    maxlength: 30,
  })
  documentNumber: string;

  @Prop({ type: String, required: true, enum: PassengerType })
  type: PassengerType;

  @Prop({ required: true, min: 0, default: 0 })
  extraBags: number;

  /** Total declared weight of the extra bags. */
  @Prop({ required: true, min: 0, default: 0 })
  extraBaggageWeightKg: number;

  /** Fare for this passenger summed over all segments. */
  @Prop({ required: true, min: 0 })
  fare: number;

  /** Extra-baggage fee for this passenger summed over all segments. */
  @Prop({ required: true, min: 0, default: 0 })
  baggageFee: number;
}

export const FlightPassengerSchema =
  SchemaFactory.createForClass(FlightPassenger);

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

/**
 * Flight booking (FLT-19, FLT-22). Stored in the `flightbookings` collection,
 * whose top-level field names are part of the team contract read by admin
 * booking inspection (integrations/teammate-contracts.ts): userId, status,
 * createdAt, bookingReference, totalPrice, currency, airlineId, departureAt.
 * A round trip is one document with two segments (FLT-12).
 */
@Schema({ timestamps: true })
export class FlightBooking {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: TripType })
  tripType: TripType;

  @Prop({
    type: [FlightSegmentSchema],
    required: true,
    validate: {
      validator(this: FlightBooking, segments: FlightSegment[]) {
        return segmentsMatchTripType(this.tripType, segments);
      },
      message:
        'A one-way booking has one outbound segment; a round trip has an outbound then a return segment',
    },
  })
  segments: FlightSegment[];

  @Prop({
    type: [FlightPassengerSchema],
    required: true,
    validate: {
      validator(passengers: FlightPassenger[]) {
        return (
          passengers.length >= 1 &&
          passengers.length <= MAX_PASSENGERS_PER_BOOKING &&
          compositionError(countPassengers(passengers.map((p) => p.type))) ===
            null
        );
      },
      message:
        'A booking needs at least one adult and no more infants than adults',
    },
  })
  passengers: FlightPassenger[];

  /** Outbound segment's airline (contract field for admin and moderator views). */
  @Prop({ type: Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  /** Outbound departure in UTC (contract field; drives Upcoming/Past and cancellation tiers). */
  @Prop({ required: true, type: Date })
  departureAt: Date;

  /** Seat-occupying passengers per segment. */
  @Prop({ required: true, min: 1 })
  seats: number;

  @Prop({ required: true, min: 0 })
  baseFare: number;

  @Prop({ required: true, min: 0, default: 0 })
  baggageFees: number;

  /** Agreed price: baseFare + baggageFees (FLT-19, FLT-21). */
  @Prop({ required: true, min: 0 })
  totalPrice: number;

  @Prop({ required: true, default: PLATFORM_CURRENCY })
  currency: string;

  @Prop({
    type: String,
    required: true,
    enum: FLIGHT_BOOKING_STATUSES,
    default: FlightBookingStatus.PENDING_PAYMENT,
  })
  status: FlightBookingStatus;

  /** End of the 10-minute Pending Payment hold (FLT-22); null once settled. */
  @Prop({ type: Date, default: null })
  holdExpiresAt: Date | null;

  /** Generated at confirmation (FLT-23); null before. */
  @Prop({ type: String, default: null })
  bookingReference: string | null;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({
    type: String,
    enum: [...Object.values(CancellationSource), null],
    default: null,
  })
  cancellationSource: CancellationSource | null;

  /** Refund decided at cancellation (PAY-03); null if never cancelled. */
  @Prop({ type: Number, min: 0, max: 100, default: null })
  refundPercentage: number | null;

  @Prop({ type: Number, min: 0, default: null })
  refundAmount: number | null;

  /** Person 7's refund record, once issued; its status lives there. */
  @Prop({ type: String, default: null })
  refundId: string | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export function segmentsMatchTripType(
  tripType: TripType,
  segments: readonly Pick<FlightSegment, 'direction'>[],
): boolean {
  if (tripType === TripType.ONE_WAY) {
    return (
      segments.length === 1 &&
      segments[0].direction === SegmentDirection.OUTBOUND
    );
  }
  return (
    segments.length === 2 &&
    segments[0].direction === SegmentDirection.OUTBOUND &&
    segments[1].direction === SegmentDirection.RETURN
  );
}

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// FLT-25: a user's bookings, newest first.
FlightBookingSchema.index({ userId: 1, createdAt: -1 });
// FLT-06 / FLT-29: bookings of one flight by status.
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
// Expiry job (Person 7): Pending Payment holds past their expiry.
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
// FLT-23: references are unique once issued; unconfirmed bookings hold null.
FlightBookingSchema.index(
  { bookingReference: 1 },
  {
    unique: true,
    partialFilterExpression: { bookingReference: { $type: 'string' } },
  },
);
