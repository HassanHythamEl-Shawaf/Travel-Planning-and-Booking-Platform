import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { DELETED_BY_AUTHOR_NOTE } from './blog.constants';
import { buildPublishedPostsPipeline, PostsService } from './posts.service';

/** A Mongoose query stub: `.lean().exec()`, `.exec()`, and the find chain. */
const query = (value: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['lean', 'sort', 'skip', 'limit', 'select']) {
    q[m] = () => q;
  }
  q.exec = () => Promise.resolve(value);
  return q;
};

describe('PostsService (BLG-01 – BLG-04, BLG-08, BLG-09)', () => {
  const authorId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const author = { sub: authorId.toString(), role: UserRole.USER };
  const other = { sub: new Types.ObjectId().toString(), role: UserRole.USER };
  const admin = { sub: new Types.ObjectId().toString(), role: UserRole.ADMIN };
  const session = { id: 'session' };

  let stored: Record<string, unknown>;
  let authorDoc: Record<string, unknown> | null;
  let postModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let likeModel: { exists: jest.Mock };
  let connection: { transaction: jest.Mock };
  let cascade: { deletePostChildren: jest.Mock; closeOpenReports: jest.Mock };
  let cleaner: { deleteFiles: jest.Mock };
  let service: PostsService;

  const storedPost = (extra: Record<string, unknown> = {}) => ({
    _id: postId,
    authorId,
    title: 'Five days in Aswan',
    content: 'x'.repeat(300),
    status: 'published',
    publishedAt: new Date('2026-11-01T10:00:00Z'),
    tags: ['egypt'],
    images: [],
    likeCount: 2,
    commentCount: 1,
    isHidden: false,
    createdAt: new Date('2026-11-01T09:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...extra,
  });

  beforeEach(() => {
    stored = storedPost();
    authorDoc = {
      _id: authorId,
      name: 'Alice',
      status: AccountStatus.ACTIVE,
    };
    postModel = {
      create: jest.fn().mockImplementation((doc: Record<string, unknown>) =>
        Promise.resolve({
          ...doc,
          toObject: () => ({ ...storedPost(), ...doc }),
        }),
      ),
      findById: jest.fn().mockImplementation(() => query(stored)),
      findOneAndUpdate: jest
        .fn()
        .mockImplementation(
          (_f: unknown, update: { $set: Record<string, unknown> }) =>
            query({ ...stored, ...update.$set }),
        ),
      deleteOne: jest.fn().mockReturnValue(query({ deletedCount: 1 })),
      aggregate: jest.fn().mockReturnValue(query([{ items: [], total: [] }])),
      find: jest.fn().mockReturnValue(query([])),
      countDocuments: jest.fn().mockReturnValue(query(0)),
    };
    userModel = {
      findById: jest.fn().mockImplementation(() => query(authorDoc)),
    };
    likeModel = { exists: jest.fn().mockReturnValue(query(null)) };
    connection = {
      transaction: jest.fn(async (fn: (s: unknown) => unknown) => fn(session)),
    };
    cascade = {
      deletePostChildren: jest.fn().mockResolvedValue([]),
      closeOpenReports: jest.fn().mockResolvedValue(0),
    };
    cleaner = { deleteFiles: jest.fn().mockResolvedValue(undefined) };
    service = new PostsService(
      connection as never,
      postModel as never,
      userModel as never,
      likeModel as never,
      cascade as never,
      cleaner as never,
    );
  });

  describe('create', () => {
    it('saves a draft by default without publishedAt', async () => {
      await service.create(author, { title: 'Title', content: 'Body' });
      expect(postModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', publishedAt: null, tags: [] }),
      );
    });

    it('sets publishedAt when created published', async () => {
      await service.create(author, {
        title: 'Title',
        content: 'Body',
        status: 'published',
      });
      expect(postModel.create.mock.calls[0][0].publishedAt).toBeInstanceOf(Date);
    });

    it('normalises tags and rejects a sixth', async () => {
      await service.create(author, {
        title: 'Title',
        content: 'Body',
        tags: ['Cairo ', 'cairo', 'Nile'],
      });
      expect(postModel.create.mock.calls[0][0].tags).toEqual(['cairo', 'nile']);
      await expect(
        service.create(author, {
          title: 'Title',
          content: 'Body',
          tags: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the detail with owner fields', async () => {
      const detail = await service.create(author, {
        title: 'Title',
        content: 'Body',
      });
      expect(detail).toMatchObject({
        title: 'Title',
        status: 'draft',
        isHidden: false,
        isOwner: true,
        likedByMe: false,
        author: { id: authorId.toString(), name: 'Alice' },
      });
    });
  });

  describe('findOne', () => {
    it('hides status and isHidden from non-owners', async () => {
      const detail = await service.findOne(postId.toString(), undefined);
      expect(detail.status).toBeUndefined();
      expect(detail.isHidden).toBeUndefined();
      expect(detail.isOwner).toBe(false);
      expect(detail.excerpt).toHaveLength(200);
    });

    it('reports likedByMe for a viewer who liked the post', async () => {
      likeModel.exists.mockReturnValue(query({ _id: new Types.ObjectId() }));
      const detail = await service.findOne(postId.toString(), other);
      expect(detail.likedByMe).toBe(true);
      expect(likeModel.exists).toHaveBeenCalledWith({
        postId,
        userId: new Types.ObjectId(other.sub),
      });
    });

    it('never queries likes for a guest', async () => {
      const detail = await service.findOne(postId.toString(), undefined);
      expect(detail.likedByMe).toBe(false);
      expect(likeModel.exists).not.toHaveBeenCalled();
    });

    it('shows status and isHidden to admins', async () => {
      const detail = await service.findOne(postId.toString(), admin);
      expect(detail).toMatchObject({ status: 'published', isHidden: false });
    });

    it('answers 404 for a draft to everyone but the author', async () => {
      stored = storedPost({ status: 'draft', publishedAt: null });
      for (const viewer of [undefined, other, admin]) {
        await expect(
          service.findOne(postId.toString(), viewer),
        ).rejects.toThrow(NotFoundException);
      }
      await expect(
        service.findOne(postId.toString(), author),
      ).resolves.toMatchObject({ status: 'draft' });
    });

    it('answers 404 when the author is deactivated, except to admins', async () => {
      authorDoc = { ...authorDoc, status: AccountStatus.DEACTIVATED };
      await expect(
        service.findOne(postId.toString(), other),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.findOne(postId.toString(), admin),
      ).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    it('answers 403 to a non-owner who can see the post', async () => {
      await expect(
        service.update(postId.toString(), other, { title: 'Mine now' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.update(postId.toString(), admin, { title: 'Mine now' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('answers 404 to a non-owner who cannot see it', async () => {
      stored = storedPost({ status: 'draft', publishedAt: null });
      await expect(
        service.update(postId.toString(), other, { title: 'Mine now' }),
      ).rejects.toThrow(NotFoundException);
      stored = storedPost({ isHidden: true });
      await expect(
        service.update(postId.toString(), other, { title: 'Mine now' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 400 for an empty update', async () => {
      await expect(
        service.update(postId.toString(), author, {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets publishedAt on the first publish only (D3)', async () => {
      stored = storedPost({ status: 'draft', publishedAt: null });
      await service.update(postId.toString(), author, { status: 'published' });
      expect(postModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
      expect(postModel.findOneAndUpdate.mock.calls[1][0]).toEqual({
        _id: postId,
        publishedAt: null,
      });
    });

    it('keeps publishedAt when republishing a post that went back to draft', async () => {
      const first = new Date('2026-10-01T00:00:00Z');
      stored = storedPost({ status: 'draft', publishedAt: first });
      const detail = await service.update(postId.toString(), author, {
        status: 'published',
      });
      expect(postModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(detail.publishedAt).toEqual(first);
    });

    it('moves a published post back to draft', async () => {
      const detail = await service.update(postId.toString(), author, {
        status: 'draft',
      });
      expect(detail.status).toBe('draft');
      expect(postModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { status: 'draft' },
      });
    });

    it('lets the author edit a hidden post, which stays hidden', async () => {
      stored = storedPost({ isHidden: true });
      const detail = await service.update(postId.toString(), author, {
        content: 'Edited',
      });
      expect(detail).toMatchObject({ content: 'Edited', isHidden: true });
    });

    it('normalises tags on update', async () => {
      await service.update(postId.toString(), author, { tags: ['Luxor '] });
      expect(postModel.findOneAndUpdate.mock.calls[0][1]).toEqual({
        $set: { tags: ['luxor'] },
      });
    });
  });

  describe('remove (D6)', () => {
    it('deletes the post, its children and closes open reports in one transaction', async () => {
      const commentIds = [new Types.ObjectId(), new Types.ObjectId()];
      cascade.deletePostChildren.mockResolvedValue(commentIds);

      await expect(
        service.remove(postId.toString(), author),
      ).resolves.toEqual({ id: postId.toString(), deleted: true });

      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(postModel.deleteOne).toHaveBeenCalledWith(
        { _id: postId, authorId },
        { session },
      );
      expect(cascade.deletePostChildren).toHaveBeenCalledWith(postId, session);
      expect(cascade.closeOpenReports).toHaveBeenCalledWith(
        [
          { type: 'post', ids: [postId] },
          { type: 'comment', ids: commentIds },
        ],
        DELETED_BY_AUTHOR_NOTE,
        session,
      );
    });

    it('deletes image files only after the commit', async () => {
      stored = storedPost({
        images: [
          { imageId: 'i1', url: '/u/i1' },
          { imageId: 'i2', url: '/u/i2' },
        ],
      });
      let committed = false;
      connection.transaction.mockImplementation(
        async (fn: (s: unknown) => unknown) => {
          const result = await fn(session);
          committed = true;
          return result;
        },
      );
      cleaner.deleteFiles.mockImplementation(() => {
        expect(committed).toBe(true);
        return Promise.resolve();
      });
      await service.remove(postId.toString(), author);
      expect(cleaner.deleteFiles).toHaveBeenCalledWith(['i1', 'i2']);
    });

    it('answers 404 if the post vanished before the delete', async () => {
      postModel.deleteOne.mockReturnValue(query({ deletedCount: 0 }));
      await expect(service.remove(postId.toString(), author)).rejects.toThrow(
        NotFoundException,
      );
      expect(cascade.closeOpenReports).not.toHaveBeenCalled();
      expect(cleaner.deleteFiles).not.toHaveBeenCalled();
    });

    it('answers 403 to a non-owner and never deletes', async () => {
      await expect(service.remove(postId.toString(), other)).rejects.toThrow(
        ForbiddenException,
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });
  });

  describe('listMine (D5)', () => {
    it('filters by author and optional status, newest update first', async () => {
      postModel.find.mockReturnValue(
        query([storedPost({ status: 'draft', isHidden: true })]),
      );
      postModel.countDocuments.mockReturnValue(query(11));

      const result = await service.listMine(author, 'draft', getPagination(2));
      expect(postModel.find).toHaveBeenCalledWith({
        authorId,
        status: 'draft',
      });
      expect(result).toMatchObject({ page: 2, total: 11, totalPages: 2 });
      expect(result.items[0]).toMatchObject({
        status: 'draft',
        isHidden: true,
        likeCount: 2,
        commentCount: 1,
        author: { name: 'Alice' },
      });
    });
  });

  describe('listPublished', () => {
    it('maps rows and totals', async () => {
      postModel.aggregate.mockReturnValue(
        query([
          {
            items: [
              {
                ...storedPost({ images: [{ imageId: 'i1', url: '/u/i1.jpg' }] }),
                author: { _id: authorId, name: 'Alice' },
              },
            ],
            total: [{ count: 1 }],
          },
        ]),
      );
      const result = await service.listPublished({}, getPagination(1));
      expect(result).toMatchObject({ total: 1, totalPages: 1, page: 1 });
      expect(result.items[0]).toMatchObject({
        coverImage: '/u/i1.jpg',
        author: { id: authorId.toString(), name: 'Alice' },
      });
    });

    it('rejects an invalid tag filter with 400', async () => {
      await expect(
        service.listPublished({ tag: 'new york' }, getPagination(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('normalises the tag filter and ignores a blank q', async () => {
      await service.listPublished({ tag: ' Egypt', q: '  ' }, getPagination(1));
      const [match, lookupMatch] = [
        postModel.aggregate.mock.calls[0][0][0].$match,
        postModel.aggregate.mock.calls[0][0][3].$match,
      ];
      expect(match.tags).toBe('egypt');
      expect(lookupMatch.$or).toBeUndefined();
    });
  });
});

describe('buildPublishedPostsPipeline (BLG-09, D8, D9)', () => {
  const page = getPagination(2);

  it('matches only published, non-hidden posts plus the filters', () => {
    const authorId = new Types.ObjectId();
    const [first] = buildPublishedPostsPipeline(
      { tags: 'egypt', authorId },
      undefined,
      page,
    );
    expect(first).toEqual({
      $match: {
        tags: 'egypt',
        authorId,
        status: 'published',
        isHidden: { $ne: true },
      },
    });
  });

  it('cannot be overridden by a status or isHidden in the filters', () => {
    const [first] = buildPublishedPostsPipeline(
      { status: 'draft', isHidden: true },
      undefined,
      page,
    );
    expect(first).toMatchObject({
      $match: { status: 'published', isHidden: { $ne: true } },
    });
  });

  it('drops deactivated authors after the lookup', () => {
    const stages = buildPublishedPostsPipeline({}, undefined, page);
    expect(stages[1]).toMatchObject({
      $lookup: { from: 'users', localField: 'authorId', foreignField: '_id' },
    });
    expect(stages[2]).toEqual({ $unwind: '$author' });
    expect(stages[3]).toEqual({
      $match: { 'author.status': { $ne: 'deactivated' } },
    });
  });

  it('matches q literally in title, tags and author name', () => {
    const stages = buildPublishedPostsPipeline({}, 'a.b*', page);
    const or = (stages[3] as { $match: { $or: Record<string, RegExp>[] } })
      .$match.$or;
    expect(or.map((c) => Object.keys(c)[0])).toEqual([
      'title',
      'tags',
      'author.name',
    ]);
    const regex = or[0].title;
    expect(regex.flags).toBe('i');
    expect(regex.test('A.B* guide')).toBe(true);
    expect(regex.test('aXbb')).toBe(false);
  });

  it('orders by likes + comments, then newest, then _id (D8)', () => {
    const stages = buildPublishedPostsPipeline({}, undefined, page);
    expect(stages[4]).toEqual({
      $addFields: {
        score: {
          $add: [
            { $ifNull: ['$likeCount', 0] },
            { $ifNull: ['$commentCount', 0] },
          ],
        },
      },
    });
    expect(stages[5]).toEqual({ $sort: { score: -1, publishedAt: -1, _id: -1 } });
  });

  it('paginates inside a facet with the total', () => {
    const stages = buildPublishedPostsPipeline({}, undefined, page);
    const facet = (stages[6] as { $facet: Record<string, unknown[]> }).$facet;
    expect(facet.items.slice(0, 2)).toEqual([{ $skip: 10 }, { $limit: 10 }]);
    expect(facet.total).toEqual([{ $count: 'count' }]);
  });
});
