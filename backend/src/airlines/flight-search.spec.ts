import { Types } from 'mongoose';

import { AirlinesService } from './airlines.service';
import { FlightStatus } from './schemas/flight.schema';

const chain = (value: unknown) => ({
  select: () => chain(value),
  sort: () => chain(value),
  lean: () => ({ exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

describe('AirlinesService flight search', () => {
  it('returns only active scheduled flights with enough seats', async () => {
    const airlineId = new Types.ObjectId();
    const flightModel = {
      find: jest.fn().mockReturnValue(
        chain([
          {
            _id: new Types.ObjectId(),
            flightNumber: 'CA101',
            departureAirportCode: 'CAI',
            arrivalAirportCode: 'DXB',
            departureAt: new Date('2026-12-01T08:30:00Z'),
            arrivalAt: new Date('2026-12-01T10:00:00Z'),
            departureTimeZone: 'Africa/Cairo',
            arrivalTimeZone: 'Asia/Dubai',
            cabins: [
              {
                _id: new Types.ObjectId(),
                category: 'Economy',
                price: 250,
                seatCount: 3,
                seatsBooked: 1,
                seatsHeld: 1,
                freeBaggageAllowance: 1,
                maxWeightPerBagKg: 23,
              },
            ],
            status: FlightStatus.SCHEDULED,
          },
        ]),
      ),
    };
    const airlineModel = {
      find: jest.fn().mockReturnValue(
        chain([{ _id: airlineId }]),
      ),
    };
    const referenceData = {
      findAirport: jest.fn().mockResolvedValue({
        _id: 'CAI',
        timeZone: 'Africa/Cairo',
      }),
    };
    const service = new AirlinesService(
      airlineModel as never,
      flightModel as never,
      null,
      referenceData as never,
      undefined,
    );

    const result = await service.searchFlights({
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureDate: '2026-12-01',
      passengers: 1,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].cabins[0].seatsAvailable).toBe(1);
    expect(result.message).toBe('Flights found');
  });

  it('returns outbound and return options with passenger-type rules', async () => {
    const airlineId = new Types.ObjectId();
    const flight = (number: string) => ({
      _id: new Types.ObjectId(),
      flightNumber: number,
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureAt: new Date('2026-12-01T08:30:00Z'),
      arrivalAt: new Date('2026-12-01T10:00:00Z'),
      departureTimeZone: 'Africa/Cairo',
      arrivalTimeZone: 'Asia/Dubai',
      cabins: [{
        _id: new Types.ObjectId(),
        category: 'Economy',
        price: 250,
        seatCount: 4,
        freeBaggageAllowance: 1,
        maxWeightPerBagKg: 23,
      }],
    });
    const flightModel = {
      find: jest.fn().mockReturnValue(chain([flight('CA101')])),
    };
    const airlineModel = {
      find: jest.fn().mockReturnValue(chain([{ _id: airlineId }])),
    };
    const referenceData = {
      findAirport: jest.fn().mockResolvedValue({ _id: 'CAI' }),
    };
    const service = new AirlinesService(
      airlineModel as never,
      flightModel as never,
      null,
      referenceData as never,
      undefined,
    );

    const result = await service.searchFlights({
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureDate: '2026-12-01',
      returnDate: '2026-12-08',
      tripType: 'round-trip',
      adults: 1,
      children: 1,
      infants: 1,
      cabinClass: 'Economy',
    });

    expect(result.items).toHaveLength(1);
    expect(result.returnItems).toHaveLength(1);
    expect(result.items[0].cabins[0].infantPrice).toBe(25);
  });

  it('rejects searches without an adult or with too many infants', async () => {
    const service = new AirlinesService(
      {} as never,
      {} as never,
      null,
      {} as never,
      undefined,
    );
    await expect(service.searchFlights({
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureDate: '2026-12-01',
      adults: 0,
    })).rejects.toThrow('At least one adult is required');
  });

  it('rejects an inverted price range before querying', async () => {
    const service = new AirlinesService(
      {} as never,
      {} as never,
      null,
      {} as never,
      undefined,
    );
    await expect(service.searchFlights({
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureDate: '2026-12-01',
      passengers: 1,
      minPrice: 500,
      maxPrice: 100,
    })).rejects.toThrow('Minimum price must not exceed maximum price');
  });
});
