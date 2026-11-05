import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { DELETED_BY_AUTHOR_NOTE } from './blog.constants';
import { CommentsService } from './comments.service';

const query = (value: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['lean', 'sort', 'skip', 'limit', 'session']) {
    q[m] = () => q;
  }
  q.exec = () => Promise.resolve(value);
  return q;
};

describe('CommentsService (BLG-05, BLG-07)', () => {
  const postAuthorId = new Types.ObjectId();
  const commenterId = new Types.ObjectId();
  const postId = new Types.ObjectId();
  const commentId = new Types.ObjectId();
  const commenter = { sub: commenterId.toString(), role: UserRole.USER };
  const postAuthor = { sub: postAuthorId.toString(), role: UserRole.USER };
  const other = { sub: new Types.ObjectId().toString(), role: UserRole.USER };
  const admin = { sub: new Types.ObjectId().toString(), role: UserRole.ADMIN };
  const session = { id: 'session' };

  let post: Record<string, unknown>;
  let comment: Record<string, unknown>;
  let users: Record<string, unknown>[];
  let commentModel: Record<string, jest.Mock>;
  let postModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let posts: { loadViewable: jest.Mock; findAuthor: jest.Mock };
  let cascade: { adjustCommentCount: jest.Mock; closeOpenReports: jest.Mock };
  let connection: { transaction: jest.Mock };
  let service: CommentsService;

  const activeAuthor = () => ({
    _id: postAuthorId,
    name: 'Alice',
    status: AccountStatus.ACTIVE,
  });

  beforeEach(() => {
    post = {
      _id: postId,
      authorId: postAuthorId,
      status: 'published',
      isHidden: false,
    };
    comment = {
      _id: commentId,
      postId,
      authorId: commenterId,
      content: 'Lovely',
      isHidden: false,
      editedAt: null,
      createdAt: new Date(),
    };
    users = [{ _id: commenterId, name: 'Bob', status: AccountStatus.ACTIVE }];
    commentModel = {
      find: jest.fn().mockImplementation(() => query([comment])),
      countDocuments: jest.fn().mockReturnValue(query(1)),
      findById: jest.fn().mockImplementation(() => query(comment)),
      create: jest.fn().mockImplementation((docs: Record<string, unknown>[]) =>
        Promise.resolve([
          { toObject: () => ({ ...comment, ...docs[0], _id: commentId }) },
        ]),
      ),
      findOneAndUpdate: jest
        .fn()
        .mockImplementation(
          (_f: unknown, update: { $set: Record<string, unknown> }) =>
            query({ ...comment, ...update.$set }),
        ),
      findOneAndDelete: jest.fn().mockImplementation(() => query(comment)),
    };
    postModel = {
      updateOne: jest.fn().mockReturnValue(query({ matchedCount: 1 })),
      findById: jest.fn().mockImplementation(() => query(post)),
    };
    userModel = { find: jest.fn().mockImplementation(() => query(users)) };
    posts = {
      loadViewable: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ post, author: activeAuthor() }),
        ),
      findAuthor: jest.fn().mockImplementation(() => Promise.resolve(activeAuthor())),
    };
    cascade = {
      adjustCommentCount: jest.fn().mockResolvedValue(undefined),
      closeOpenReports: jest.fn().mockResolvedValue(0),
    };
    connection = {
      transaction: jest.fn(async (fn: (s: unknown) => unknown) => fn(session)),
    };
    service = new CommentsService(
      connection as never,
      commentModel as never,
      postModel as never,
      userModel as never,
      posts as never,
      cascade as never,
    );
  });

  describe('list (D12)', () => {
    it('lists oldest first and omits hidden comments for guests', async () => {
      const result = await service.list(
        postId.toString(),
        undefined,
        getPagination(1),
      );
      expect(commentModel.find).toHaveBeenCalledWith({
        postId,
        isHidden: { $ne: true },
      });
      expect(result.items[0]).toMatchObject({
        content: 'Lovely',
        author: { id: commenterId.toString(), name: 'Bob' },
        isOwner: false,
      });
      expect(result.items[0].isHidden).toBeUndefined();
    });

    it("includes a user's own hidden comments", async () => {
      await service.list(postId.toString(), commenter, getPagination(1));
      expect(commentModel.find).toHaveBeenCalledWith({
        postId,
        $or: [{ isHidden: { $ne: true } }, { authorId: commenterId }],
      });
    });

    it('shows every comment to admins with isHidden', async () => {
      comment = { ...comment, isHidden: true };
      const result = await service.list(
        postId.toString(),
        admin,
        getPagination(1),
      );
      expect(commentModel.find).toHaveBeenCalledWith({ postId });
      expect(result.items[0].isHidden).toBe(true);
    });

    it('shows "Deleted user" for a deactivated comment author', async () => {
      users = [{ ...users[0], status: AccountStatus.DEACTIVATED }];
      const result = await service.list(
        postId.toString(),
        undefined,
        getPagination(1),
      );
      expect(result.items[0].author).toEqual({ id: null, name: 'Deleted user' });
    });

    it('answers 404 when the post is not viewable', async () => {
      posts.loadViewable.mockRejectedValue(new NotFoundException());
      await expect(
        service.list(postId.toString(), undefined, getPagination(1)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (D11)', () => {
    it('inserts and increments commentCount in one transaction', async () => {
      const created = await service.create(postId.toString(), commenter, 'Hi');
      expect(connection.transaction).toHaveBeenCalledTimes(1);
      expect(commentModel.create).toHaveBeenCalledWith(
        [{ postId, authorId: commenterId, content: 'Hi' }],
        { session },
      );
      expect(postModel.updateOne).toHaveBeenCalledWith(
        { _id: postId, status: 'published', isHidden: { $ne: true } },
        { $inc: { commentCount: 1 } },
        { session },
      );
      expect(created).toMatchObject({ content: 'Hi', isOwner: true, isHidden: false });
    });

    it('answers 404 on a hidden post even for its author', async () => {
      post = { ...post, isHidden: true };
      await expect(
        service.create(postId.toString(), postAuthor, 'Hi'),
      ).rejects.toThrow(NotFoundException);
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('answers 404 on a draft for its author', async () => {
      post = { ...post, status: 'draft' };
      await expect(
        service.create(postId.toString(), postAuthor, 'Hi'),
      ).rejects.toThrow(NotFoundException);
    });

    it('aborts when the post was hidden meanwhile', async () => {
      postModel.updateOne.mockReturnValue(query({ matchedCount: 0 }));
      await expect(
        service.create(postId.toString(), commenter, 'Hi'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('update (BLG-07)', () => {
    it('lets the author edit and sets editedAt', async () => {
      const updated = await service.update(commentId.toString(), commenter, 'Edited');
      expect(commentModel.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({
        content: 'Edited',
        editedAt: expect.any(Date),
      });
      expect(updated.content).toBe('Edited');
    });

    it('lets the author edit after the post was hidden', async () => {
      post = { ...post, isHidden: true };
      await expect(
        service.update(commentId.toString(), commenter, 'Edited'),
      ).resolves.toBeDefined();
    });

    it('answers 403 to others who can see it, including the post author and admins', async () => {
      for (const viewer of [other, postAuthor, admin]) {
        await expect(
          service.update(commentId.toString(), viewer, 'Mine'),
        ).rejects.toThrow(ForbiddenException);
      }
    });

    it('answers 404 to others when the comment is hidden', async () => {
      comment = { ...comment, isHidden: true };
      await expect(
        service.update(commentId.toString(), other, 'Mine'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when the comment does not exist', async () => {
      commentModel.findById.mockReturnValue(query(null));
      await expect(
        service.update(commentId.toString(), commenter, 'x'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove (D6, D7)', () => {
    it('deletes, decrements and closes reports in one transaction', async () => {
      await expect(
        service.remove(commentId.toString(), commenter),
      ).resolves.toEqual({ id: commentId.toString(), deleted: true });
      expect(commentModel.findOneAndDelete).toHaveBeenCalledWith(
        { _id: commentId, authorId: commenterId },
        { session },
      );
      expect(cascade.adjustCommentCount).toHaveBeenCalledWith(postId, -1, session);
      expect(cascade.closeOpenReports).toHaveBeenCalledWith(
        [{ type: 'comment', ids: [commentId] }],
        DELETED_BY_AUTHOR_NOTE,
        session,
      );
    });

    it('does not decrement for a hidden comment', async () => {
      comment = { ...comment, isHidden: true };
      await service.remove(commentId.toString(), commenter);
      expect(cascade.adjustCommentCount).not.toHaveBeenCalled();
    });

    it('never lets the post author delete other people\'s comments', async () => {
      await expect(
        service.remove(commentId.toString(), postAuthor),
      ).rejects.toThrow(ForbiddenException);
      expect(connection.transaction).not.toHaveBeenCalled();
    });
  });
});
