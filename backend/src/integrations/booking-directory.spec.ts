import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { MongoBookingDirectory } from './booking-directory';

describe('MongoBookingDirectory', () => {
  let aggregate: jest.Mock;
  let distinct: jest.Mock;
  let collection: jest.Mock;
  let directory: MongoBookingDirectory;

  beforeEach(() => {
    aggregate = jest.fn().mockReturnValue({
      toArray: () => Promise.resolve([{ items: [], total: [] }]),
    });
    distinct = jest.fn().mockResolvedValue([]);
    collection = jest.fn().mockReturnValue({ aggregate, distinct });
    directory = new MongoBookingDirectory({ collection } as never);
  });

  const unionTargets = (): string[] =>
    (aggregate.mock.calls[0][0] as Record<string, any>[])
      .filter((stage) => stage.$unionWith)
      .map((stage) => stage.$unionWith.coll);

  it('rejects from > to with 400', async () => {
    await expect(
      directory.listAll(
        { from: new Date('2026-02-01'), to: new Date('2026-01-01') },
        getPagination(1),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(aggregate).not.toHaveBeenCalled();
  });

  it('unions both collections when no type is given', async () => {
    await directory.listAll({}, getPagination(1));
    expect(collection).toHaveBeenCalledWith('flightbookings');
    expect(unionTargets()).toEqual(['hotelbookings']);
  });

  it('reads only the hotel collection when type=hotel', async () => {
    await directory.listAll({ type: 'hotel' }, getPagination(1));
    expect(collection).toHaveBeenCalledWith('hotelbookings');
    expect(collection).not.toHaveBeenCalledWith('flightbookings');
    expect(unionTargets()).toEqual([]);
  });

  it('applies status and the createdAt range in every branch', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await directory.listAll(
      { status: 'Confirmed', from, to },
      getPagination(2),
    );

    const pipeline = aggregate.mock.calls[0][0] as Record<string, any>[];
    const expected = {
      status: 'Confirmed',
      createdAt: { $gte: from, $lte: to },
    };
    expect(pipeline[0].$match).toEqual(expected);
    const union = pipeline.find((stage) => stage.$unionWith);
    expect(union.$unionWith.pipeline[0].$match).toEqual(expected);
    const facet = pipeline.find((stage) => stage.$facet).$facet;
    expect(facet.items[0]).toEqual({ $skip: 10 });
  });

  it('maps rows and returns an empty page for missing collections', async () => {
    await expect(directory.listAll({}, getPagination(1))).resolves.toEqual({
      items: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });

    const id = new Types.ObjectId();
    const userId = new Types.ObjectId();
    aggregate.mockReturnValue({
      toArray: () =>
        Promise.resolve([
          {
            items: [
              {
                _id: id,
                type: 'flight',
                bookingReference: 'ABC123',
                status: 'Confirmed',
                userId,
                providerId: null,
                totalPrice: 100,
                currency: 'EGP',
                createdAt: new Date('2026-01-05'),
                user: [{ name: 'Sara', email: 'sara@example.com' }],
              },
            ],
            total: [{ count: 11 }],
          },
        ]),
    });
    const result = await directory.listAll({}, getPagination(1));
    expect(result.totalPages).toBe(2);
    expect(result.items[0]).toMatchObject({
      id: id.toString(),
      userId: userId.toString(),
      userName: 'Sara',
      userEmail: 'sara@example.com',
    });
  });

  it('finds distinct upcoming confirmed users for an airline', async () => {
    const userId = new Types.ObjectId();
    distinct.mockResolvedValue([userId, null]);
    const airlineId = new Types.ObjectId();

    await expect(
      directory.findUserIdsWithUpcomingConfirmedBookings(
        'airline',
        airlineId.toString(),
      ),
    ).resolves.toEqual([userId.toString()]);
    expect(collection).toHaveBeenCalledWith('flightbookings');
    const [field, query] = distinct.mock.calls[0];
    expect(field).toBe('userId');
    expect(query.airlineId).toEqual(airlineId);
    expect(query.status).toBe('Confirmed');
    expect(query.departureAt.$gt).toBeInstanceOf(Date);
  });
});
