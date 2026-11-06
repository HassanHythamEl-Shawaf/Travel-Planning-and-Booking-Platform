import { Types } from 'mongoose';

import { createDefaultHandlers } from './default-handlers';

type Collection = {
  findOne: jest.Mock;
  updateOne: jest.Mock;
  deleteOne: jest.Mock;
  deleteMany: jest.Mock;
};

const emptyCollection = (): Collection => ({
  findOne: jest.fn().mockResolvedValue(null),
  updateOne: jest
    .fn()
    .mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
});

describe('default moderation handlers (GEN-09, GEN-10)', () => {
  const session = { id: 'session' } as never;
  const authorId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const id = new Types.ObjectId();

  let collections: Record<string, Collection>;
  let handlers: ReturnType<typeof createDefaultHandlers>;

  beforeEach(() => {
    collections = {
      posts: emptyCollection(),
      comments: emptyCollection(),
      likes: emptyCollection(),
      reviews: emptyCollection(),
      itineraries: emptyCollection(),
      users: emptyCollection(),
    };
    const connection = {
      collection: jest.fn((name: string) => collections[name]),
    };
    handlers = createDefaultHandlers(connection as never);
  });

  describe('post', () => {
    const post = (extra: Record<string, unknown>) =>
      collections.posts.findOne.mockResolvedValue({
        _id: id,
        authorId,
        title: 'Aswan',
        content: 'x'.repeat(300),
        ...extra,
      });

    it('is publicly visible only when published and not hidden', async () => {
      post({ status: 'published' });
      const found = await handlers.post.find(id.toString());
      expect(found).toEqual({
        id: id.toString(),
        type: 'post',
        authorId: authorId.toString(),
        isHidden: false,
        publiclyVisible: true,
        snapshot: { title: 'Aswan', excerpt: 'x'.repeat(200) },
      });

      post({ status: 'draft' });
      expect((await handlers.post.find(id.toString()))?.publiclyVisible).toBe(
        false,
      );

      post({ status: 'published', isHidden: true });
      expect(await handlers.post.find(id.toString())).toMatchObject({
        isHidden: true,
        publiclyVisible: false,
      });
    });

    it('returns null for a missing post or collection without throwing', async () => {
      await expect(handlers.post.find(id.toString())).resolves.toBeNull();
      await expect(handlers.post.find('not-an-id')).resolves.toBeNull();
      await expect(
        handlers.post.setHidden(id.toString(), true, session),
      ).resolves.toBe(false);
      await expect(handlers.post.delete!(id.toString(), session)).resolves.toBe(
        false,
      );
      expect(collections.comments.deleteMany).not.toHaveBeenCalled();
    });

    it('hides conditionally on the current state', async () => {
      collections.posts.updateOne.mockResolvedValue({ modifiedCount: 1 });
      await expect(
        handlers.post.setHidden(id.toString(), true, session),
      ).resolves.toBe(true);
      expect(collections.posts.updateOne).toHaveBeenCalledWith(
        { _id: id, isHidden: { $ne: true } },
        { $set: { isHidden: true } },
        { session },
      );

      collections.posts.updateOne.mockResolvedValue({ modifiedCount: 0 });
      await expect(
        handlers.post.setHidden(id.toString(), false, session),
      ).resolves.toBe(false);
      expect(collections.posts.updateOne).toHaveBeenLastCalledWith(
        { _id: id, isHidden: true },
        { $set: { isHidden: false } },
        { session },
      );
    });

    it('deletes the post with its comments and likes in the same session', async () => {
      collections.posts.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await expect(handlers.post.delete!(id.toString(), session)).resolves.toBe(
        true,
      );
      expect(collections.posts.deleteOne).toHaveBeenCalledWith(
        { _id: id },
        { session },
      );
      expect(collections.comments.deleteMany).toHaveBeenCalledWith(
        { postId: id },
        { session },
      );
      expect(collections.likes.deleteMany).toHaveBeenCalledWith(
        { postId: id },
        { session },
      );
    });
  });

  describe('comment', () => {
    const comment = (extra: Record<string, unknown> = {}) =>
      collections.comments.findOne.mockResolvedValue({
        _id: id,
        postId,
        authorId,
        content: 'Nice trip',
        ...extra,
      });
    const parent = (extra: Record<string, unknown>) =>
      collections.posts.findOne.mockResolvedValue({
        _id: postId,
        authorId: new Types.ObjectId(),
        ...extra,
      });

    it('is visible when its parent post is published, visible and its author active', async () => {
      comment();
      parent({ status: 'published' });
      collections.users.findOne.mockResolvedValue({ status: 'suspended' });
      expect(await handlers.comment.find(id.toString())).toEqual({
        id: id.toString(),
        type: 'comment',
        authorId: authorId.toString(),
        isHidden: false,
        publiclyVisible: true,
        snapshot: { excerpt: 'Nice trip' },
      });
    });

    it.each([
      ['a draft post', { status: 'draft' }, null],
      ['a hidden post', { status: 'published', isHidden: true }, null],
      ['a deactivated post author', { status: 'published' }, 'deactivated'],
    ])('is not visible under %s', async (_label, parentDoc, authorStatus) => {
      comment();
      parent(parentDoc);
      collections.users.findOne.mockResolvedValue(
        authorStatus ? { status: authorStatus } : null,
      );
      expect((await handlers.comment.find(id.toString()))?.publiclyVisible).toBe(
        false,
      );
    });

    it('is not visible when hidden itself or when the parent is missing', async () => {
      comment({ isHidden: true });
      parent({ status: 'published' });
      expect((await handlers.comment.find(id.toString()))?.publiclyVisible).toBe(
        false,
      );

      comment();
      collections.posts.findOne.mockResolvedValue(null);
      expect((await handlers.comment.find(id.toString()))?.publiclyVisible).toBe(
        false,
      );
    });

    it('deletes only the comment', async () => {
      collections.comments.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await expect(
        handlers.comment.delete!(id.toString(), session),
      ).resolves.toBe(true);
      expect(collections.likes.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('review', () => {
    it('maps userId to the author and has no default delete', async () => {
      collections.reviews.findOne.mockResolvedValue({
        _id: id,
        userId: authorId,
        comment: 'Clean rooms',
      });
      expect(await handlers.review.find(id.toString())).toMatchObject({
        authorId: authorId.toString(),
        publiclyVisible: true,
        snapshot: { excerpt: 'Clean rooms' },
      });
      expect(handlers.review.delete).toBeUndefined();
    });

    it('is not visible when hidden', async () => {
      collections.reviews.findOne.mockResolvedValue({
        _id: id,
        userId: authorId,
        comment: 'x',
        isHidden: true,
      });
      expect((await handlers.review.find(id.toString()))?.publiclyVisible).toBe(
        false,
      );
    });
  });

  describe('itinerary', () => {
    it('is visible only when public and not hidden, and has no default delete', async () => {
      collections.itineraries.findOne.mockResolvedValue({
        _id: id,
        ownerId: authorId,
        title: 'Five days in Luxor',
        isPublic: true,
      });
      expect(await handlers.itinerary.find(id.toString())).toMatchObject({
        authorId: authorId.toString(),
        publiclyVisible: true,
        snapshot: { title: 'Five days in Luxor', excerpt: 'Five days in Luxor' },
      });

      collections.itineraries.findOne.mockResolvedValue({
        _id: id,
        ownerId: authorId,
        title: 'Private',
        isPublic: false,
      });
      expect(
        (await handlers.itinerary.find(id.toString()))?.publiclyVisible,
      ).toBe(false);
      expect(handlers.itinerary.delete).toBeUndefined();
    });
  });
});
