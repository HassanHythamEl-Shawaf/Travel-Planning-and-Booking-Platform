import { Types } from 'mongoose';

import { AirlinesService } from './airlines.service';
import { FlightStatus } from './schemas/flight.schema';

const chain = (value: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
});

describe('AirlinesService flight details', () => {
  it('returns local times, duration, cabin data and cancellation policy', async () => {
    const flightId = new Types.ObjectId();
    const airlineId = new Types.ObjectId();
    const flightModel = {
      findById: jest.fn().mockReturnValue(
        chain({
          _id: flightId,
          airlineId,
          flightNumber: 'CA101',
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'DXB',
          departureAt: new Date('2027-01-01T08:30:00Z'),
          arrivalAt: new Date('2027-01-01T10:00:00Z'),
          departureTimeZone: 'Africa/Cairo',
          arrivalTimeZone: 'Asia/Dubai',
          status: FlightStatus.SCHEDULED,
          cabins: [{
            _id: new Types.ObjectId(),
            category: 'Economy',
            seatCount: 120,
            seatsBooked: 30,
            seatsHeld: 10,
            price: 250,
            freeBaggageAllowance: 1,
            maxWeightPerBagKg: 23,
          }],
        }),
      ),
    };
    const airlineModel = {
      findById: jest.fn().mockReturnValue(
        chain({
          _id: airlineId,
          name: 'Cairo Air',
          code: 'CA',
          cancellationPolicy: [
            { daysBeforeDeparture: 30, refundPercentage: 75 },
          ],
        }),
      ),
    };
    const service = new AirlinesService(
      airlineModel as never,
      flightModel as never,
      null,
      undefined,
      undefined,
    );

    const result = await service.getFlightDetails(flightId.toString());

    expect(result.airlineName).toBe('Cairo Air');
    expect(result.departureLocalTime).toContain('10:30');
    expect(result.arrivalLocalTime).toContain('14:00');
    expect(result.durationMinutes).toBe(90);
    expect(result.cabins[0].seatsRemaining).toBe(80);
    expect(result.cancellationPolicy[0].refundPercentage).toBe(75);
  });
});
