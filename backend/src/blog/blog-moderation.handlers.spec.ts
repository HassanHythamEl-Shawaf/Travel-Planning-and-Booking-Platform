import { Types } from 'mongoose';

import { AccountStatus } from '../users/schemas/user.schema';
import {
  BlogModerationHandlers,
  CommentModerationHandler,
  PARENT_POST_DELETED_NOTE,
  PostModerationHandler,
} from './blog-moderation.handlers';

const query = (value: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['lean', 'session']) q[m] = () => q;
  q.exec = () => Promise.resolve(value);
  return q;
};

describe('Blog moderation handlers (D18, GEN-09, GEN-10)', () => {
  const session = { id: 'session' } as never;
  const postId = new Types.ObjectId();
  const commentId = new Types.ObjectId();
  const authorId = new Types.ObjectId();

  let post: Record<string, unknown> | null;
  let comment: Record<string, unknown> | null;
  let postAuthor: Record<string, unknown> | null;
  let postModel: Record<string, jest.Mock>;
  let commentModel: Record<string, jest.Mock>;
  let userModel: Record<string, jest.Mock>;
  let cascade: {
    deletePostChildren: jest.Mock;
    closeOpenReports: jest.Mock;
    adjustCommentCount: jest.Mock;
  };
  let cleaner: { deleteFiles: jest.Mock };

  beforeEach(() => {
    post = {
      _id: postId,
      authorId,
      title: 'Aswan',
      content: 'x'.repeat(250),
      status: 'published',
      isHidden: false,
      images: [{ imageId: 'i1', url: '/u/i1' }],
    };
    comment = {
      _id: commentId,
      postId,
      authorId: new Types.ObjectId(),
      content: 'Spam link',
      isHidden: false,
    };
    postAuthor = { status: AccountStatus.ACTIVE };
    postModel = {
      findById: jest.fn().mockImplementation(() => query(post)),
      updateOne: jest.fn().mockReturnValue(query({ modifiedCount: 1 })),
      deleteOne: jest.fn().mockReturnValue(query({ deletedCount: 1 })),
    };
    commentModel = {
      findById: jest.fn().mockImplementation(() => query(comment)),
      findOneAndUpdate: jest.fn().mockImplementation(() => query(comment)),
      findOneAndDelete: jest.fn().mockImplementation(() => query(comment)),
    };
    userModel = { findById: jest.fn().mockImplementation(() => query(postAuthor)) };
    cascade = {
      deletePostChildren: jest.fn().mockResolvedValue([commentId]),
      closeOpenReports: jest.fn().mockResolvedValue(1),
      adjustCommentCount: jest.fn().mockResolvedValue(undefined),
    };
    cleaner = { deleteFiles: jest.fn().mockResolvedValue(undefined) };
  });

  describe('post', () => {
    const handler = () =>
      new PostModerationHandler(
        postModel as never,
        cascade as never,
        cleaner as never,
      );

    it('finds a post with its snapshot, visibility and image assets', async () => {
      await expect(handler().find(postId.toString(), session)).resolves.toEqual({
        id: postId.toString(),
        type: 'post',
        authorId: authorId.toString(),
        isHidden: false,
        publiclyVisible: true,
        snapshot: { title: 'Aswan', excerpt: 'x'.repeat(200) },
        assets: ['i1'],
      });
    });

    it('treats drafts and hidden posts as not publicly visible', async () => {
      post = { ...post, status: 'draft' };
      expect((await handler().find(postId.toString()))?.publiclyVisible).toBe(false);
      post = { ...post, status: 'published', isHidden: true };
      expect((await handler().find(postId.toString()))?.publiclyVisible).toBe(false);
    });

    it('returns null for a missing post or a malformed id', async () => {
      post = null;
      await expect(handler().find(postId.toString())).resolves.toBeNull();
      await expect(handler().find('nope')).resolves.toBeNull();
    });

    it('hides conditionally on the current state', async () => {
      await expect(handler().setHidden(postId.toString(), true, session)).resolves.toBe(true);
      expect(postModel.updateOne).toHaveBeenCalledWith(
        { _id: postId, isHidden: { $ne: true } },
        { $set: { isHidden: true } },
        { session },
      );
      postModel.updateOne.mockReturnValue(query({ modifiedCount: 0 }));
      await expect(handler().setHidden(postId.toString(), false, session)).resolves.toBe(false);
      expect(postModel.updateOne.mock.calls[1][0]).toEqual({ _id: postId, isHidden: true });
    });

    it('deletes with the cascade and closes only the comments\' reports', async () => {
      await expect(handler().delete(postId.toString(), session)).resolves.toBe(true);
      expect(cascade.deletePostChildren).toHaveBeenCalledWith(postId, session);
      expect(cascade.closeOpenReports).toHaveBeenCalledWith(
        [{ type: 'comment', ids: [commentId] }],
        PARENT_POST_DELETED_NOTE,
        session,
      );
    });

    it('returns false without cascading when the post is gone', async () => {
      postModel.deleteOne.mockReturnValue(query({ deletedCount: 0 }));
      await expect(handler().delete(postId.toString(), session)).resolves.toBe(false);
      expect(cascade.deletePostChildren).not.toHaveBeenCalled();
    });

    it('removes image files in afterDelete', async () => {
      const content = await handler().find(postId.toString());
      await handler().afterDelete(content!);
      expect(cleaner.deleteFiles).toHaveBeenCalledWith(['i1']);
    });
  });

  describe('comment', () => {
    const handler = () =>
      new CommentModerationHandler(
        commentModel as never,
        postModel as never,
        userModel as never,
        cascade as never,
      );

    it('is publicly visible only while it and its parent post are', async () => {
      expect((await handler().find(commentId.toString()))?.publiclyVisible).toBe(true);

      post = { ...post, isHidden: true };
      expect((await handler().find(commentId.toString()))?.publiclyVisible).toBe(false);

      post = { ...post, isHidden: false };
      postAuthor = { status: AccountStatus.DEACTIVATED };
      expect((await handler().find(commentId.toString()))?.publiclyVisible).toBe(false);

      postAuthor = { status: AccountStatus.ACTIVE };
      comment = { ...comment, isHidden: true };
      expect((await handler().find(commentId.toString()))?.publiclyVisible).toBe(false);
    });

    it('decrements commentCount when hidden and increments it when unhidden', async () => {
      await expect(handler().setHidden(commentId.toString(), true, session)).resolves.toBe(true);
      expect(cascade.adjustCommentCount).toHaveBeenLastCalledWith(postId, -1, session);
      await handler().setHidden(commentId.toString(), false, session);
      expect(cascade.adjustCommentCount).toHaveBeenLastCalledWith(postId, 1, session);
    });

    it('never touches the counter when the state did not change', async () => {
      commentModel.findOneAndUpdate.mockReturnValue(query(null));
      await expect(handler().setHidden(commentId.toString(), true, session)).resolves.toBe(false);
      expect(cascade.adjustCommentCount).not.toHaveBeenCalled();
    });

    it('decrements on delete only if the comment was visible', async () => {
      await expect(handler().delete(commentId.toString(), session)).resolves.toBe(true);
      expect(cascade.adjustCommentCount).toHaveBeenCalledWith(postId, -1, session);

      cascade.adjustCommentCount.mockClear();
      comment = { ...comment, isHidden: true };
      await handler().delete(commentId.toString(), session);
      expect(cascade.adjustCommentCount).not.toHaveBeenCalled();

      comment = null;
      await expect(handler().delete(commentId.toString(), session)).resolves.toBe(false);
    });
  });

  it('registers both handlers with the moderation registry on init', () => {
    const registry = { register: jest.fn() };
    new BlogModerationHandlers(
      registry as never,
      postModel as never,
      commentModel as never,
      userModel as never,
      cascade as never,
      cleaner as never,
    ).onModuleInit();
    expect(registry.register.mock.calls.map((c) => c[0])).toEqual(['post', 'comment']);
    expect(registry.register.mock.calls[0][1]).toBeInstanceOf(PostModerationHandler);
    expect(registry.register.mock.calls[1][1]).toBeInstanceOf(CommentModerationHandler);
  });
});
