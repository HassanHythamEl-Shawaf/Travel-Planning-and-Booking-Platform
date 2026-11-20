import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { LikesService } from './likes.service';

const query = (value: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['lean', 'session']) q[m] = () => q;
  q.exec = () => Promise.resolve(value);
  return q;
};

describe('LikesService (BLG-06, D13)', () => {
  const postId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const viewer = { sub: userId.toString(), role: UserRole.USER };
  const session = { id: 'session' };

  let post: Record<string, unknown>;
  let likeCount: number;
  let likeModel: Record<string, jest.Mock>;
  let postModel: Record<string, jest.Mock>;
  let posts: { loadViewable: jest.Mock };
  let connection: { transaction: jest.Mock };
  let service: LikesService;

  beforeEach(() => {
    likeCount = 3;
    post = {
      _id: postId,
      authorId: new Types.ObjectId(),
      status: 'published',
      isHidden: false,
    };
    likeModel = {
      updateOne: jest.fn().mockReturnValue(query({ upsertedCount: 1 })),
      deleteOne: jest.fn().mockReturnValue(query({ deletedCount: 1 })),
    };
    postModel = {
      findOneAndUpdate: jest
        .fn()
        .mockImplementation(() => query({ likeCount: ++likeCount })),
      updateOne: jest.fn().mockImplementation(() => {
        likeCount -= 1;
        return query({ modifiedCount: 1 });
      }),
      findById: jest.fn().mockImplementation(() => query({ likeCount })),
    };
    posts = {
      loadViewable: jest.fn().mockImplementation(() =>
        Promise.resolve({ post, author: { status: AccountStatus.ACTIVE } }),
      ),
    };
    connection = {
      transaction: jest.fn(async (fn: (s: unknown) => unknown) => fn(session)),
    };
    service = new LikesService(
      connection as never,
      likeModel as never,
      postModel as never,
      posts as never,
    );
  });

  it('inserts the like and increments the counter in one transaction', async () => {
    await expect(service.like(postId.toString(), viewer)).resolves.toEqual({
      liked: true,
      likeCount: 4,
    });
    expect(likeModel.updateOne).toHaveBeenCalledWith(
      { postId, userId },
      { $setOnInsert: { postId, userId } },
      { upsert: true, session },
    );
    expect(postModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: postId,
      status: 'published',
      isHidden: { $ne: true },
    });
  });

  it('is idempotent: an existing like changes nothing', async () => {
    likeModel.updateOne.mockReturnValue(query({ upsertedCount: 0 }));
    await expect(service.like(postId.toString(), viewer)).resolves.toEqual({
      liked: true,
      likeCount: 3,
    });
    expect(postModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('treats a duplicate-key race as already liked (never 409 or 500)', async () => {
    connection.transaction.mockRejectedValueOnce(
      Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
    );
    await expect(service.like(postId.toString(), viewer)).resolves.toEqual({
      liked: true,
      likeCount: 3,
    });
  });

  it('rethrows other errors', async () => {
    connection.transaction.mockRejectedValueOnce(new Error('network'));
    await expect(service.like(postId.toString(), viewer)).rejects.toThrow(
      'network',
    );
  });

  it('aborts when the post was hidden between the check and the write', async () => {
    postModel.findOneAndUpdate.mockReturnValue(query(null));
    await expect(service.like(postId.toString(), viewer)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('answers 404 for a draft or hidden post', async () => {
    post = { ...post, isHidden: true };
    await expect(service.like(postId.toString(), viewer)).rejects.toThrow(
      NotFoundException,
    );
    post = { ...post, isHidden: false, status: 'draft' };
    await expect(service.unlike(postId.toString(), viewer)).rejects.toThrow(
      NotFoundException,
    );
    expect(connection.transaction).not.toHaveBeenCalled();
  });

  it('removes a like and decrements only while positive', async () => {
    await expect(service.unlike(postId.toString(), viewer)).resolves.toEqual({
      liked: false,
      likeCount: 2,
    });
    expect(postModel.updateOne).toHaveBeenCalledWith(
      { _id: postId, likeCount: { $gt: 0 } },
      { $inc: { likeCount: -1 } },
      { session },
    );
  });

  it('is idempotent: removing a missing like never decrements', async () => {
    likeModel.deleteOne.mockReturnValue(query({ deletedCount: 0 }));
    await expect(service.unlike(postId.toString(), viewer)).resolves.toEqual({
      liked: false,
      likeCount: 3,
    });
    expect(postModel.updateOne).not.toHaveBeenCalled();
  });
});
