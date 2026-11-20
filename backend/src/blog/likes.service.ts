import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { POST_STATUS } from '../integrations/teammate-contracts';
import { isPubliclyVisible } from './blog-visibility';
import { LikeStateDto } from './dto/comment.dto';
import { type LeanPost, PostsService } from './posts.service';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';

const isDuplicateKey = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 11000;

/**
 * BLG-06 (D13). Both operations are idempotent. The like row and the
 * counter change in one transaction, so concurrent requests can never count
 * a like twice; a duplicate-key error from a race means "already liked".
 */
@Injectable()
export class LikesService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Like.name) private readonly likeModel: Model<Like>,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    private readonly posts: PostsService,
  ) {}

  async like(
    postId: string,
    viewer: AuthenticatedUser,
  ): Promise<LikeStateDto> {
    const post = await this.loadLikeable(postId, viewer);
    const userId = new Types.ObjectId(viewer.sub);

    try {
      return await this.connection.transaction(async (session) => {
        const inserted = await this.likeModel
          .updateOne(
            { postId: post._id, userId },
            { $setOnInsert: { postId: post._id, userId } },
            { upsert: true, session },
          )
          .exec();
        if (inserted.upsertedCount !== 1) {
          return { liked: true, likeCount: await this.count(post._id, session) };
        }
        const counted = await this.postModel
          .findOneAndUpdate(
            {
              _id: post._id,
              status: POST_STATUS.PUBLISHED,
              isHidden: { $ne: true },
            },
            { $inc: { likeCount: 1 } },
            { session, returnDocument: 'after', projection: { likeCount: 1 } },
          )
          .lean<Pick<LeanPost, 'likeCount'>>()
          .exec();
        // Hidden, unpublished or deleted meanwhile: abort the insert too.
        if (!counted) throw new NotFoundException('Post not found');
        return { liked: true, likeCount: counted.likeCount };
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      return { liked: true, likeCount: await this.count(post._id) };
    }
  }

  async unlike(
    postId: string,
    viewer: AuthenticatedUser,
  ): Promise<LikeStateDto> {
    const post = await this.loadLikeable(postId, viewer);
    const userId = new Types.ObjectId(viewer.sub);

    return this.connection.transaction(async (session) => {
      const removed = await this.likeModel
        .deleteOne({ postId: post._id, userId }, { session })
        .exec();
      if (removed.deletedCount === 1) {
        // Never below 0 (D13).
        await this.postModel
          .updateOne(
            { _id: post._id, likeCount: { $gt: 0 } },
            { $inc: { likeCount: -1 } },
            { session },
          )
          .exec();
      }
      return { liked: false, likeCount: await this.count(post._id, session) };
    });
  }

  /** Likes only on published, visible posts (404 otherwise). */
  private async loadLikeable(
    postId: string,
    viewer: AuthenticatedUser,
  ): Promise<LeanPost> {
    const { post, author } = await this.posts.loadViewable(postId, viewer);
    if (!isPubliclyVisible(post, author)) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  private async count(
    postId: Types.ObjectId,
    session?: ClientSession,
  ): Promise<number> {
    const post = await this.postModel
      .findById(postId, { likeCount: 1 })
      .session(session ?? null)
      .lean<Pick<LeanPost, 'likeCount'>>()
      .exec();
    return post?.likeCount ?? 0;
  }
}
