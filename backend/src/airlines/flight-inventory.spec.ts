import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';

import {
  FlightInventoryService,
} from './flight-inventory';
import { InventoryHoldStatus } from './schemas/flight-inventory-hold.schema';

const chain = (value: unknown) => ({
  lean: () => ({ exec: () => Promise.resolve(value) }),
  exec: () => Promise.resolve(value),
});

describe('FlightInventoryService', () => {
  const flightId = new Types.ObjectId().toString();
  const cabinId = new Types.ObjectId().toString();
  let held = 0;
  let flightModel: {
    findById: jest.Mock;
    findOneAndUpdate: jest.Mock;
    updateOne: jest.Mock;
  };
  let holdModel: { create: jest.Mock; findOneAndUpdate: jest.Mock };
  let service: FlightInventoryService;

  beforeEach(() => {
    held = 0;
    flightModel = {
      findById: jest.fn().mockReturnValue(
        chain({
          cabins: [
            {
              _id: new Types.ObjectId(cabinId),
              seatCount: 3,
              seatsBooked: 0,
              seatsHeld: 0,
            },
          ],
        }),
      ),
      findOneAndUpdate: jest.fn().mockImplementation(() => {
        if (held >= 3) return chain(null);
        held += 1;
        return chain({ _id: new Types.ObjectId(flightId) });
      }),
      updateOne: jest.fn().mockReturnValue(chain({ modifiedCount: 1 })),
    };
    holdModel = {
      create: jest.fn().mockResolvedValue(undefined),
      findOneAndUpdate: jest.fn().mockReturnValue(
        chain({
          flightId: new Types.ObjectId(flightId),
          cabinId: new Types.ObjectId(cabinId),
          seats: 1,
          status: InventoryHoldStatus.HELD,
        }),
      ),
    };
    service = new FlightInventoryService(
      flightModel as never,
      holdModel as never,
    );
  });

  it('allows parallel holds only up to the cabin capacity', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.createHold(
          flightId,
          cabinId,
          1,
          new Date(Date.now() + 60_000),
        ),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(7);
    expect(
      results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .every((result) => result.reason instanceof ConflictException),
    ).toBe(true);
    expect(held).toBe(3);
    expect(flightModel.findOneAndUpdate).toHaveBeenCalledTimes(10);
  });

  it('reports available seats after held and booked seats', async () => {
    flightModel.findById.mockReturnValue(
      chain({
        cabins: [
          {
            _id: new Types.ObjectId(cabinId),
            seatCount: 10,
            seatsBooked: 4,
            seatsHeld: 2,
          },
        ],
      }),
    );

    await expect(service.checkAvailability(flightId, cabinId)).resolves.toEqual({
      flightId,
      cabinId,
      seatsTotal: 10,
      seatsBooked: 4,
      seatsHeld: 2,
      seatsAvailable: 4,
    });
  });
});
