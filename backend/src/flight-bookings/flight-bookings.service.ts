import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';

import { FLIGHT_INVENTORY } from '../airlines/flight-inventory';
import type { FlightInventoryReader } from '../airlines/flight-inventory';
import { Airline } from '../airlines/schemas/airline.schema';
import { Cabin, Flight, FlightStatus } from '../airlines/schemas/flight.schema';
import {
  CreateFlightBookingDto,
  FlightSelectionDto,
  PassengerInputDto,
} from './dto/create-flight-booking.dto';
import {
  FlightBookingResponseDto,
  FlightBookingSummaryDto,
  FlightPassengerResponseDto,
  FlightSegmentResponseDto,
} from './dto/flight-booking-response.dto';
import {
  HOLD_DURATION_MINUTES,
  INVENTORY_HOLD_GRACE_MINUTES,
  PLATFORM_CURRENCY,
  SegmentDirection,
  TripType,
} from './flight-booking.constants';
import { FlightBookingStatus } from './flight-booking-status';
import {
  ageOnDate,
  compositionError,
  countPassengers,
  fareForPassenger,
  passengerTypeForAge,
  roundMoney,
} from './passenger-rules';
import {
  FlightBooking,
  FlightBookingDocument,
  FlightPassenger,
  FlightSegment,
} from './schemas/flight-booking.schema';

type LeanFlight = Flight & { _id: Types.ObjectId };
type LeanAirline = Airline & { _id: Types.ObjectId };

/** A flight, its airline and the chosen cabin, all validated as bookable. */
interface BookableSegment {
  direction: SegmentDirection;
  flight: LeanFlight;
  airline: LeanAirline;
  cabin: Cabin & { _id: Types.ObjectId };
}

/** Everything needed to store a booking, before seats are held. */
interface PricedBooking {
  tripType: TripType;
  segments: FlightSegment[];
  passengers: FlightPassenger[];
  airlineId: Types.ObjectId;
  departureAt: Date;
  seats: number;
  baseFare: number;
  baggageFees: number;
  totalPrice: number;
  currency: string;
}

@Injectable()
export class FlightBookingsService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookingModel: Model<FlightBooking>,
    @InjectModel(Flight.name)
    private readonly flightModel: Model<Flight>,
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @Inject(FLIGHT_INVENTORY)
    private readonly inventory: FlightInventoryReader,
  ) {}

  /**
   * FLT-19 / FLT-21: validates passengers and baggage and returns the price
   * summary. Nothing is saved and no seats are held.
   */
  async quote(dto: CreateFlightBookingDto): Promise<FlightBookingSummaryDto> {
    const priced = await this.price(dto, { checkSeats: true });
    return toSummary(priced);
  }

  /**
   * FLT-22: re-validates and prices the request, then reserves the seats of
   * every segment through Person 3's inventory interface (an atomic
   * check-and-increment per flight) and stores the booking in Pending
   * Payment for 10 minutes. A round trip either holds both flights or
   * neither: if any step fails, holds already taken are released.
   */
  async hold(
    userId: string,
    dto: CreateFlightBookingDto,
  ): Promise<FlightBookingResponseDto> {
    const priced = await this.price(dto, { checkSeats: false });
    const holdExpiresAt = new Date(Date.now() + HOLD_DURATION_MINUTES * 60_000);

    const inventoryExpiresAt = new Date(
      holdExpiresAt.getTime() + INVENTORY_HOLD_GRACE_MINUTES * 60_000,
    );

    const heldIds: string[] = [];
    try {
      for (const segment of priced.segments) {
        segment.holdId = await this.holdSeats(segment, inventoryExpiresAt);
        heldIds.push(segment.holdId);
      }
      const booking = await this.bookingModel.create({
        ...priced,
        userId: new Types.ObjectId(userId),
        status: FlightBookingStatus.PENDING_PAYMENT,
        holdExpiresAt,
      });
      return toResponse(booking);
    } catch (error) {
      await Promise.allSettled(
        heldIds.map((holdId) => this.inventory.releaseHold(holdId)),
      );
      throw error;
    }
  }

  private async holdSeats(
    segment: FlightSegment,
    expiresAt: Date,
  ): Promise<string> {
    try {
      const hold = await this.inventory.createHold(
        segment.flightId.toString(),
        segment.cabinId.toString(),
        segment.seats,
        expiresAt,
      );
      return hold.holdId;
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new ConflictException(
          `Not enough ${segment.cabinCategory} seats left on flight ${segment.flightNumber}`,
        );
      }
      throw error;
    }
  }

  /** Shared validation and pricing for the summary and the hold. */
  private async price(
    dto: CreateFlightBookingDto,
    options: { checkSeats: boolean },
  ): Promise<PricedBooking> {
    const outbound = await this.loadSegment(
      SegmentDirection.OUTBOUND,
      dto.outbound,
    );
    const bookable = [outbound];
    if (dto.returnFlight) {
      const inbound = await this.loadSegment(
        SegmentDirection.RETURN,
        dto.returnFlight,
      );
      assertReturnMatchesOutbound(outbound.flight, inbound.flight);
      bookable.push(inbound);
    }

    const travelDate = outbound.flight.departureLocalDate;
    dto.passengers.forEach((p, i) => assertPassengerType(p, i, travelDate));
    assertUniqueDocuments(dto.passengers);
    const composition = countPassengers(dto.passengers.map((p) => p.type));
    const problem = compositionError(composition);
    if (problem) throw new BadRequestException(problem);

    if (options.checkSeats) {
      for (const { flight, cabin } of bookable) {
        assertSeatsAvailable(flight, cabin, composition.seats);
      }
    }

    const passengers = dto.passengers.map((p, i) =>
      pricePassenger(p, i, bookable),
    );
    const baseFare = roundMoney(sum(passengers.map((p) => p.fare)));
    const baggageFees = roundMoney(sum(passengers.map((p) => p.baggageFee)));

    return {
      tripType: dto.returnFlight ? TripType.ROUND_TRIP : TripType.ONE_WAY,
      segments: bookable.map((s) => toSegment(s, composition.seats)),
      passengers,
      airlineId: outbound.flight.airlineId,
      departureAt: outbound.flight.departureAt,
      seats: composition.seats,
      baseFare,
      baggageFees,
      totalPrice: roundMoney(baseFare + baggageFees),
      currency: PLATFORM_CURRENCY,
    };
  }

  /**
   * FLT-30 / ACC-15: only a Scheduled flight that has not departed, of an
   * active airline, with the chosen cabin, can be booked.
   */
  private async loadSegment(
    direction: SegmentDirection,
    selection: FlightSelectionDto,
  ): Promise<BookableSegment> {
    const label =
      direction === SegmentDirection.OUTBOUND ? 'Outbound' : 'Return';
    const flight = await this.flightModel
      .findById(selection.flightId)
      .lean<LeanFlight>()
      .exec();
    if (!flight) throw new NotFoundException(`${label} flight not found`);
    if (
      flight.status !== FlightStatus.SCHEDULED ||
      flight.departureAt.getTime() <= Date.now()
    ) {
      throw new ConflictException(
        `${label} flight ${flight.flightNumber} is no longer open for booking`,
      );
    }

    const airline = await this.airlineModel
      .findById(flight.airlineId)
      .lean<LeanAirline>()
      .exec();
    if (!airline) throw new NotFoundException(`${label} airline not found`);
    if (airline.isActive === false) {
      throw new ConflictException(
        `${airline.name} is not accepting new bookings`,
      );
    }

    const cabin = flight.cabins.find(
      (candidate) => candidate.category === selection.cabinCategory,
    );
    if (!cabin?._id) {
      throw new NotFoundException(
        `${label} flight ${flight.flightNumber} has no ${selection.cabinCategory} cabin`,
      );
    }
    return {
      direction,
      flight,
      airline,
      cabin: cabin as Cabin & { _id: Types.ObjectId },
    };
  }
}

/** FLT-12: the return flight flies the reverse route after the outbound lands. */
function assertReturnMatchesOutbound(
  outbound: LeanFlight,
  inbound: LeanFlight,
): void {
  if (
    inbound.departureAirportCode !== outbound.arrivalAirportCode ||
    inbound.arrivalAirportCode !== outbound.departureAirportCode
  ) {
    throw new BadRequestException(
      `The return flight must fly ${outbound.arrivalAirportCode} to ${outbound.departureAirportCode}`,
    );
  }
  if (inbound.departureAt.getTime() <= outbound.arrivalAt.getTime()) {
    throw new BadRequestException(
      'The return flight must depart after the outbound flight arrives',
    );
  }
}

/** FLT-12 / FLT-19: the declared type must match the age on the travel date. */
function assertPassengerType(
  passenger: PassengerInputDto,
  index: number,
  travelDate: string,
): void {
  const who = `Passenger ${index + 1} (${passenger.fullName.trim()})`;
  const age = ageOnDate(passenger.dateOfBirth, travelDate);
  if (age === null) {
    throw new BadRequestException(
      `${who}: date of birth must be a real date on or before the travel date`,
    );
  }
  const expected = passengerTypeForAge(age);
  if (expected !== passenger.type) {
    throw new BadRequestException(
      `${who}: is ${age} on ${travelDate}, so the passenger type must be ${expected}, not ${passenger.type}`,
    );
  }
}

function assertUniqueDocuments(passengers: readonly PassengerInputDto[]): void {
  const seen = new Set<string>();
  for (const passenger of passengers) {
    const document = passenger.documentNumber.toUpperCase();
    if (seen.has(document)) {
      throw new BadRequestException(
        `Document number ${document} is used for more than one passenger`,
      );
    }
    seen.add(document);
  }
}

/** Mirrors FlightInventoryService.checkAvailability: total - booked - held. */
function assertSeatsAvailable(
  flight: LeanFlight,
  cabin: Cabin,
  seats: number,
): void {
  const available =
    cabin.seatCount - (cabin.seatsBooked ?? 0) - (cabin.seatsHeld ?? 0);
  if (available < seats) {
    throw new ConflictException(
      `Not enough ${cabin.category} seats left on flight ${flight.flightNumber}`,
    );
  }
}

/**
 * FLT-19 / FLT-08 / FLT-12: fare and extra-baggage fee over all segments.
 * Extra bags apply to every flight of the trip, so they must fit each
 * airline's limit and each cabin's weight limit.
 */
function pricePassenger(
  passenger: PassengerInputDto,
  index: number,
  segments: readonly BookableSegment[],
): FlightPassenger {
  const who = `Passenger ${index + 1} (${passenger.fullName.trim()})`;
  const extraBags = passenger.extraBags ?? 0;
  const weight = passenger.extraBaggageWeightKg ?? 0;

  if (extraBags === 0 && weight > 0) {
    throw new BadRequestException(
      `${who}: extra baggage weight needs at least one extra bag`,
    );
  }

  let fare = 0;
  let baggageFee = 0;
  for (const { flight, airline, cabin } of segments) {
    const policy = airline.baggagePolicy;
    const maxExtraBags = policy?.maxExtraBagsPerPassenger ?? 0;
    if (extraBags > maxExtraBags) {
      throw new BadRequestException(
        `${who}: at most ${maxExtraBags} extra bag(s) allowed on flight ${flight.flightNumber}`,
      );
    }
    const maxWeight = extraBags * cabin.maxWeightPerBagKg;
    if (weight > maxWeight) {
      throw new BadRequestException(
        `${who}: ${extraBags} extra bag(s) may weigh at most ${maxWeight} kg in total on flight ${flight.flightNumber}`,
      );
    }
    fare += fareForPassenger(passenger.type, cabin.price);
    baggageFee += extraBags * (policy?.pricePerExtraBag ?? 0);
  }

  return {
    fullName: passenger.fullName.trim(),
    dateOfBirth: new Date(`${passenger.dateOfBirth}T00:00:00.000Z`),
    documentNumber: passenger.documentNumber.toUpperCase(),
    type: passenger.type,
    extraBags,
    extraBaggageWeightKg: weight,
    fare: roundMoney(fare),
    baggageFee: roundMoney(baggageFee),
  };
}

/** Copies the flight, cabin and policy values the user is agreeing to. */
function toSegment(
  { direction, flight, airline, cabin }: BookableSegment,
  seats: number,
): FlightSegment {
  return {
    direction,
    flightId: flight._id,
    airlineId: flight.airlineId,
    flightNumber: flight.flightNumber,
    departureAirportCode: flight.departureAirportCode,
    arrivalAirportCode: flight.arrivalAirportCode,
    departureAt: flight.departureAt,
    arrivalAt: flight.arrivalAt,
    departureTimeZone: flight.departureTimeZone,
    arrivalTimeZone: flight.arrivalTimeZone,
    cabinId: cabin._id,
    cabinCategory: cabin.category,
    cabinFare: cabin.price,
    freeBaggageAllowance: cabin.freeBaggageAllowance,
    maxWeightPerBagKg: cabin.maxWeightPerBagKg,
    pricePerExtraBag: airline.baggagePolicy?.pricePerExtraBag ?? 0,
    maxExtraBagsPerPassenger:
      airline.baggagePolicy?.maxExtraBagsPerPassenger ?? 0,
    seats,
    holdId: null,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function localTime(at: Date, zone: string): string {
  return DateTime.fromJSDate(at)
    .setZone(zone)
    .toISO({ suppressMilliseconds: true })!;
}

function toSegmentResponse(segment: FlightSegment): FlightSegmentResponseDto {
  return {
    direction: segment.direction,
    flightId: segment.flightId.toString(),
    airlineId: segment.airlineId.toString(),
    flightNumber: segment.flightNumber,
    departureAirportCode: segment.departureAirportCode,
    arrivalAirportCode: segment.arrivalAirportCode,
    departureAt: segment.departureAt,
    arrivalAt: segment.arrivalAt,
    departureLocalTime: localTime(
      segment.departureAt,
      segment.departureTimeZone,
    ),
    arrivalLocalTime: localTime(segment.arrivalAt, segment.arrivalTimeZone),
    departureTimeZone: segment.departureTimeZone,
    arrivalTimeZone: segment.arrivalTimeZone,
    cabinCategory: segment.cabinCategory,
    cabinFare: segment.cabinFare,
    freeBaggageAllowance: segment.freeBaggageAllowance,
    maxWeightPerBagKg: segment.maxWeightPerBagKg,
    pricePerExtraBag: segment.pricePerExtraBag,
    maxExtraBagsPerPassenger: segment.maxExtraBagsPerPassenger,
    seats: segment.seats,
  };
}

function toPassengerResponse(
  passenger: FlightPassenger,
): FlightPassengerResponseDto {
  return {
    ...(passenger._id && { id: passenger._id.toString() }),
    fullName: passenger.fullName,
    dateOfBirth: passenger.dateOfBirth.toISOString().slice(0, 10),
    documentNumber: passenger.documentNumber,
    type: passenger.type,
    extraBags: passenger.extraBags,
    extraBaggageWeightKg: passenger.extraBaggageWeightKg,
    fare: passenger.fare,
    baggageFee: passenger.baggageFee,
  };
}

function toSummary(
  booking: Pick<
    PricedBooking,
    | 'tripType'
    | 'segments'
    | 'passengers'
    | 'seats'
    | 'baseFare'
    | 'baggageFees'
    | 'totalPrice'
    | 'currency'
  >,
): FlightBookingSummaryDto {
  return {
    tripType: booking.tripType,
    segments: booking.segments.map(toSegmentResponse),
    passengers: booking.passengers.map(toPassengerResponse),
    seats: booking.seats,
    baseFare: booking.baseFare,
    baggageFees: booking.baggageFees,
    totalPrice: booking.totalPrice,
    currency: booking.currency,
  };
}

export function toResponse(
  booking: FlightBookingDocument,
): FlightBookingResponseDto {
  return {
    id: booking._id.toString(),
    status: booking.status,
    ...toSummary(booking),
    holdExpiresAt: booking.holdExpiresAt,
    bookingReference: booking.bookingReference,
    createdAt: booking.createdAt,
  };
}
