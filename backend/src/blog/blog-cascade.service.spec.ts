import { Types } from 'mongoose';

import { BlogCascadeService } from './blog-cascade.service';

describe('BlogCascadeService (D6, D7)', () => {
  const session = { id: 'session' };
  const postId = new Types.ObjectId();
  let collections: Record<string, Record<string, jest.Mock>>;
  let reportModel: { updateMany: jest.Mock };
  let service: BlogCascadeService;

  beforeEach(() => {
    const collection = () => ({
      find: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    });
    collections = {
      posts: collection(),
      comments: collection(),
      likes: collection(),
    };
    reportModel = {
      updateMany: jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 2 }) }),
    };
    service = new BlogCascadeService(
      { collection: (name: string) => collections[name] } as never,
      reportModel as never,
    );
  });

  it('deletes the comments and likes of a post and returns the comment ids', async () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    collections.comments.find.mockReturnValue({
      toArray: () => Promise.resolve(ids.map((_id) => ({ _id }))),
    });

    await expect(service.deletePostChildren(postId, session as never)).resolves.toEqual(ids);
    expect(collections.comments.deleteMany).toHaveBeenCalledWith({ postId }, { session });
    expect(collections.likes.deleteMany).toHaveBeenCalledWith({ postId }, { session });
  });

  it('increments commentCount unconditionally', async () => {
    await service.adjustCommentCount(postId, 1, session as never);
    expect(collections.posts.updateOne).toHaveBeenCalledWith(
      { _id: postId },
      { $inc: { commentCount: 1 } },
      { session },
    );
  });

  it('decrements commentCount only while it is positive', async () => {
    await service.adjustCommentCount(postId, -1, session as never);
    expect(collections.posts.updateOne).toHaveBeenCalledWith(
      { _id: postId, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
      { session },
    );
  });

  it('closes open reports as content_deleted with no resolving admin', async () => {
    const commentIds = [new Types.ObjectId()];
    await expect(
      service.closeOpenReports(
        [
          { type: 'post', ids: [postId] },
          { type: 'comment', ids: commentIds },
        ],
        'Deleted by author',
        session as never,
      ),
    ).resolves.toBe(2);

    const [filter, update, options] = reportModel.updateMany.mock.calls[0];
    expect(filter).toEqual({
      status: 'open',
      $or: [
        { targetType: 'post', targetId: { $in: [postId] } },
        { targetType: 'comment', targetId: { $in: commentIds } },
      ],
    });
    expect(update.$set).toMatchObject({
      status: 'content_deleted',
      resolvedBy: null,
      resolutionNote: 'Deleted by author',
      resolvedAt: expect.any(Date),
    });
    expect(options).toEqual({ session });
  });

  it('skips the update when there is nothing to close', async () => {
    await expect(
      service.closeOpenReports(
        [{ type: 'comment', ids: [] }],
        'Deleted by author',
        session as never,
      ),
    ).resolves.toBe(0);
    expect(reportModel.updateMany).not.toHaveBeenCalled();
  });
});
