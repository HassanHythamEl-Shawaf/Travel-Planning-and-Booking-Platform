import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { CabinCategory } from '../../airlines/schemas/flight.schema';
import { BOOKING_COLLECTIONS } from '../../integrations/teammate-contracts';
import {
  PassengerType,
  SegmentDirection,
  TripType,
} from '../flight-booking.constants';
import {
  FlightBooking,
  FlightBookingSchema,
  FlightSegment,
} from './flight-booking.schema';

jest.setTimeout(60_000);

/** Validation errors keyed by path, or undefined when the document is valid. */
async function errorsOf(doc: mongoose.Document) {
  try {
    await doc.validate();
    return undefined;
  } catch (error) {
    return (error as mongoose.Error.ValidationError).errors;
  }
}

function segment(direction: SegmentDirection): FlightSegment {
  return {
    direction,
    flightId: new Types.ObjectId(),
    airlineId: new Types.ObjectId(),
    flightNumber: 'ms101',
    departureAirportCode: 'cai',
    arrivalAirportCode: 'lhr',
    departureAt: new Date('2026-12-01T08:00:00Z'),
    arrivalAt: new Date('2026-12-01T13:00:00Z'),
    departureTimeZone: 'Africa/Cairo',
    arrivalTimeZone: 'Europe/London',
    cabinId: new Types.ObjectId(),
    cabinCategory: CabinCategory.ECONOMY,
    cabinFare: 200,
    freeBaggageAllowance: 1,
    maxWeightPerBagKg: 23,
    pricePerExtraBag: 50,
    maxExtraBagsPerPassenger: 2,
    seats: 1,
    holdId: 'hold-1',
  };
}

function bookingData(overrides: Partial<FlightBooking> = {}) {
  const outbound = segment(SegmentDirection.OUTBOUND);
  return {
    userId: new Types.ObjectId(),
    tripType: TripType.ONE_WAY,
    segments: [outbound],
    passengers: [
      {
        fullName: 'Sara Hassan',
        dateOfBirth: new Date('1995-04-02'),
        documentNumber: 'a1234567',
        type: PassengerType.ADULT,
        extraBags: 1,
        extraBaggageWeightKg: 20,
        fare: 200,
        baggageFee: 50,
      },
    ],
    airlineId: outbound.airlineId,
    departureAt: outbound.departureAt,
    seats: 1,
    baseFare: 200,
    baggageFees: 50,
    totalPrice: 250,
    holdExpiresAt: new Date('2026-11-30T10:10:00Z'),
    ...overrides,
  };
}

describe('FlightBooking schema (FLT-19)', () => {
  const offline = new mongoose.Mongoose();
  const OfflineModel = offline.model(FlightBooking.name, FlightBookingSchema);

  it('is stored in the collection admin inspection reads', () => {
    expect(OfflineModel.collection.collectionName).toBe(
      BOOKING_COLLECTIONS.flight,
    );
  });

  it('accepts a valid one-way booking with contract defaults', async () => {
    const doc = new OfflineModel(bookingData());
    expect(await errorsOf(doc)).toBeUndefined();
    expect(doc.status).toBe('Pending Payment');
    expect(doc.currency).toBe('USD');
    expect(doc.bookingReference).toBeNull();
    expect(doc.segments[0].flightNumber).toBe('MS101');
    expect(doc.passengers[0].documentNumber).toBe('A1234567');
    expect(doc.passengers[0]._id).toBeInstanceOf(Types.ObjectId);
  });

  it('accepts a round trip with outbound then return segments', async () => {
    const doc = new OfflineModel(
      bookingData({
        tripType: TripType.ROUND_TRIP,
        segments: [
          segment(SegmentDirection.OUTBOUND),
          segment(SegmentDirection.RETURN),
        ],
      }),
    );
    expect(await errorsOf(doc)).toBeUndefined();
  });

  it.each([
    [
      'one-way with two segments',
      TripType.ONE_WAY,
      [SegmentDirection.OUTBOUND, SegmentDirection.RETURN],
    ],
    [
      'round trip with one segment',
      TripType.ROUND_TRIP,
      [SegmentDirection.OUTBOUND],
    ],
    [
      'round trip in the wrong order',
      TripType.ROUND_TRIP,
      [SegmentDirection.RETURN, SegmentDirection.OUTBOUND],
    ],
  ])('rejects a %s', async (_label, tripType, directions) => {
    const doc = new OfflineModel(
      bookingData({ tripType, segments: directions.map(segment) }),
    );
    expect((await errorsOf(doc))?.segments).toBeDefined();
  });

  it('rejects passengers without an adult or with too many infants', async () => {
    const base = bookingData().passengers[0];
    const childOnly = new OfflineModel(
      bookingData({ passengers: [{ ...base, type: PassengerType.CHILD }] }),
    );
    const twoInfants = new OfflineModel(
      bookingData({
        passengers: [
          base,
          { ...base, type: PassengerType.INFANT },
          { ...base, type: PassengerType.INFANT },
        ],
      }),
    );
    expect((await errorsOf(childOnly))?.passengers).toBeDefined();
    expect((await errorsOf(twoInfants))?.passengers).toBeDefined();
  });

  it('rejects a status outside the shared lifecycle', async () => {
    const doc = new OfflineModel(bookingData({ status: 'Draft' as never }));
    expect((await errorsOf(doc))?.status).toBeDefined();
  });

  describe('indexes (in-memory MongoDB)', () => {
    let server: MongoMemoryServer;
    let connection: Connection;
    let Booking: Model<FlightBooking>;

    beforeAll(async () => {
      server = await MongoMemoryServer.create();
      connection = await mongoose
        .createConnection(server.getUri(), { dbName: 'flight-bookings-test' })
        .asPromise();
      Booking = connection.model(FlightBooking.name, FlightBookingSchema);
      await Booking.syncIndexes();
    });

    afterAll(async () => {
      await connection?.close();
      await server?.stop();
    });

    it('allows many unconfirmed bookings without a reference', async () => {
      await Booking.create([bookingData(), bookingData()]);
      expect(
        await Booking.countDocuments({ bookingReference: null }),
      ).toBeGreaterThanOrEqual(2);
    });

    it('rejects a duplicate booking reference', async () => {
      await Booking.create(bookingData({ bookingReference: 'K7QM2X' }));
      await expect(
        Booking.create(bookingData({ bookingReference: 'K7QM2X' })),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });
});
