import { Types } from 'mongoose';

import { AirlinesService } from './airlines.service';
import { CabinCategory } from './schemas/flight.schema';

describe('AirlinesService flight bookings', () => {
  const flightId = new Types.ObjectId().toString();
  const airlineId = new Types.ObjectId();
  const assignments = {
    findByModeratorId: jest.fn().mockResolvedValue({
      providerType: 'airline',
      providerId: airlineId.toString(),
    }),
  };
  const flightModel = {
    findById: jest.fn().mockReturnValue({
      exec: () =>
        Promise.resolve({
          _id: flightId,
          airlineId,
          cabins: [
            {
              category: CabinCategory.ECONOMY,
              seatCount: 150,
              seatsBooked: 12,
              seatsHeld: 3,
            },
          ],
        }),
    }),
  };
  const reader = {
    listByFlightId: jest.fn().mockResolvedValue([
      {
        id: 'booking-1',
        bookingReference: 'BK-1',
        passengers: [{ id: 'passenger-1', name: 'Sara, Hassan' }],
        cabin: CabinCategory.ECONOMY,
        seats: 2,
        status: 'Confirmed',
      },
    ]),
  };

  const service = new AirlinesService(
    {} as never,
    flightModel as never,
    null,
    undefined,
    assignments as never,
    undefined,
    undefined,
    undefined,
    undefined,
    reader as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists bookings only for the assigned airline moderator', async () => {
    await expect(
      service.listFlightBookings('moderator-1', flightId),
    ).resolves.toEqual({
      flightId,
      items: [
        {
          id: 'booking-1',
          bookingReference: 'BK-1',
          passengers: [{ id: 'passenger-1', name: 'Sara, Hassan' }],
          cabin: CabinCategory.ECONOMY,
          seats: 2,
          status: 'Confirmed',
          remainingSeats: 135,
        },
      ],
    });
    expect(assignments.findByModeratorId).toHaveBeenCalledWith('moderator-1');
  });

  it('exports escaped CSV booking rows', async () => {
    await expect(
      service.exportFlightBookings('moderator-1', flightId),
    ).resolves.toBe(
      'bookingReference,passengers,cabin,seats,status,remainingSeats\r\n' +
        'BK-1,"Sara, Hassan",Economy,2,Confirmed,135',
    );
  });
});
