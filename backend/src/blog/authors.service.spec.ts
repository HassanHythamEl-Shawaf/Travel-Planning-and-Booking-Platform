import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { AuthorsService } from './authors.service';
import { PublicItineraryReader } from './public-itinerary.reader';

describe('AuthorsService (BLG-12, D16)', () => {
  const authorId = new Types.ObjectId();
  const joinedAt = new Date('2026-09-01T00:00:00Z');
  let user: Record<string, unknown> | null;
  let userModel: { findById: jest.Mock };
  let posts: { listPublished: jest.Mock };
  let itineraries: { listPublicByOwner: jest.Mock };
  let service: AuthorsService;

  const page = { items: [], page: 1, limit: 10, total: 3, totalPages: 1 };

  beforeEach(() => {
    user = {
      _id: authorId,
      name: 'Alice',
      role: UserRole.USER,
      status: AccountStatus.ACTIVE,
      createdAt: joinedAt,
    };
    userModel = {
      findById: jest.fn().mockImplementation(() => ({
        lean: () => ({ exec: () => Promise.resolve(user) }),
      })),
    };
    posts = { listPublished: jest.fn().mockResolvedValue(page) };
    itineraries = {
      listPublicByOwner: jest
        .fn()
        .mockResolvedValue([
          { id: 'x', title: 'Luxor', countries: ['EG'], createdAt: null },
        ]),
    };
    service = new AuthorsService(
      userModel as never,
      posts as never,
      itineraries as never,
    );
  });

  it('returns name, join date, published posts and up to 10 itineraries', async () => {
    const result = await service.findOne(authorId.toString(), getPagination(1));
    expect(result).toEqual({
      id: authorId.toString(),
      name: 'Alice',
      joinedAt,
      publishedPostCount: 3,
      posts: page,
      publicItineraries: [
        { id: 'x', title: 'Luxor', countries: ['EG'], createdAt: null },
      ],
    });
    expect(posts.listPublished).toHaveBeenCalledWith(
      { authorId: authorId.toString() },
      getPagination(1),
    );
    expect(itineraries.listPublicByOwner).toHaveBeenCalledWith(authorId, 10);
  });

  it('keeps suspended authors visible (ACC-16)', async () => {
    user = { ...user, status: AccountStatus.SUSPENDED };
    await expect(
      service.findOne(authorId.toString(), getPagination(1)),
    ).resolves.toBeDefined();
  });

  it.each([
    ['unknown', () => (user = null)],
    ['deactivated', () => (user = { ...user, status: AccountStatus.DEACTIVATED })],
    ['admin', () => (user = { ...user, role: UserRole.ADMIN })],
    ['moderator', () => (user = { ...user, role: UserRole.MODERATOR })],
  ])('answers 404 for a %s account', async (_label, setup) => {
    setup();
    await expect(
      service.findOne(authorId.toString(), getPagination(1)),
    ).rejects.toThrow(NotFoundException);
    expect(posts.listPublished).not.toHaveBeenCalled();
  });
});

describe('PublicItineraryReader (BLG-12)', () => {
  it('reads public, non-hidden itineraries newest first, capped', async () => {
    const ownerId = new Types.ObjectId();
    const rowId = new Types.ObjectId();
    const created = new Date();
    const find = jest.fn().mockReturnValue({
      toArray: () =>
        Promise.resolve([
          { _id: rowId, title: 'Luxor', countries: ['EG', 3], createdAt: created },
          { _id: new Types.ObjectId() },
        ]),
    });
    const collection = jest.fn().mockReturnValue({ find });
    const reader = new PublicItineraryReader({ collection } as never);

    const result = await reader.listPublicByOwner(ownerId, 10);

    expect(collection).toHaveBeenCalledWith('itineraries');
    expect(find).toHaveBeenCalledWith(
      { ownerId, isPublic: true, isHidden: { $ne: true } },
      {
        projection: { title: 1, countries: 1, createdAt: 1 },
        sort: { createdAt: -1, _id: -1 },
        limit: 10,
      },
    );
    expect(result).toEqual([
      { id: rowId.toString(), title: 'Luxor', countries: ['EG'], createdAt: created },
      { id: expect.any(String), title: '', countries: [], createdAt: null },
    ]);
  });
});
