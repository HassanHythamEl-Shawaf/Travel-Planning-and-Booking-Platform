import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import { POST_STATUS } from '../integrations/teammate-contracts';
import { ModerationRegistry } from '../moderation/moderation.registry';
import {
  type ModerationHandler,
  type ModeratableContent,
  toExcerpt,
} from '../moderation/moderation.types';
import { AccountStatus, User } from '../users/schemas/user.schema';
import { BlogCascadeService } from './blog-cascade.service';
import { BlogImageCleaner } from './blog-image-cleaner';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

/** resolutionNote on comment reports closed because an admin deleted the post. */
export const PARENT_POST_DELETED_NOTE = 'Post deleted by an administrator';

type LeanPost = Post & { _id: Types.ObjectId };
type LeanComment = Comment & { _id: Types.ObjectId };

const toObjectId = (id: string): Types.ObjectId | null =>
  /^[0-9a-fA-F]{24}$/.test(id) ? new Types.ObjectId(id) : null;

/** Conditional on the current state; a missing isHidden counts as visible. */
const hiddenFilter = (_id: Types.ObjectId, hidden: boolean) => ({
  _id,
  isHidden: hidden ? { $ne: true } : true,
});

/** GEN-09 / GEN-10 post handler (D18). */
export class PostModerationHandler implements ModerationHandler {
  constructor(
    private readonly postModel: Model<Post>,
    private readonly cascade: BlogCascadeService,
    private readonly imageCleaner: BlogImageCleaner,
  ) {}

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const post = await this.postModel
      .findById(_id)
      .session(session ?? null)
      .lean<LeanPost>()
      .exec();
    if (!post) return null;
    const isHidden = post.isHidden === true;
    return {
      id,
      type: 'post',
      authorId: post.authorId?.toString() ?? '',
      isHidden,
      publiclyVisible: post.status === POST_STATUS.PUBLISHED && !isHidden,
      snapshot: { title: post.title, excerpt: toExcerpt(post.content) },
      assets: (post.images ?? []).map((i) => i.imageId),
    };
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.postModel
      .updateOne(hiddenFilter(_id, hidden), { $set: { isHidden: hidden } }, {
        session,
      })
      .exec();
    return result.modifiedCount === 1;
  }

  /**
   * The D6 cascade: the post, its comments and likes. Open reports on the
   * comments are closed here; those on the post itself are resolved by
   * ModerationService with the admin's resolution.
   */
  async delete(id: string, session: ClientSession): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.postModel.deleteOne({ _id }, { session }).exec();
    if (result.deletedCount !== 1) return false;
    const commentIds = await this.cascade.deletePostChildren(_id, session);
    await this.cascade.closeOpenReports(
      [{ type: 'comment', ids: commentIds }],
      PARENT_POST_DELETED_NOTE,
      session,
    );
    return true;
  }

  /** After commit: remove the post's image files (best effort). */
  async afterDelete(content: ModeratableContent): Promise<void> {
    await this.imageCleaner.deleteFiles(content.assets ?? []);
  }
}

/** GEN-09 / GEN-10 comment handler (D18); keeps commentCount in step (D7). */
export class CommentModerationHandler implements ModerationHandler {
  constructor(
    private readonly commentModel: Model<Comment>,
    private readonly postModel: Model<Post>,
    private readonly userModel: Model<User>,
    private readonly cascade: BlogCascadeService,
  ) {}

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const comment = await this.commentModel
      .findById(_id)
      .session(session ?? null)
      .lean<LeanComment>()
      .exec();
    if (!comment) return null;
    const isHidden = comment.isHidden === true;
    return {
      id,
      type: 'comment',
      authorId: comment.authorId?.toString() ?? '',
      isHidden,
      publiclyVisible:
        !isHidden && (await this.parentVisible(comment.postId, session)),
      snapshot: { excerpt: toExcerpt(comment.content) },
    };
  }

  /** Hiding removes the comment from commentCount, unhiding adds it back. */
  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const changed = await this.commentModel
      .findOneAndUpdate(hiddenFilter(_id, hidden), {
        $set: { isHidden: hidden },
      }, { session, projection: { postId: 1 } })
      .lean<Pick<LeanComment, '_id' | 'postId'>>()
      .exec();
    if (!changed) return false;
    await this.cascade.adjustCommentCount(
      changed.postId,
      hidden ? -1 : 1,
      session,
    );
    return true;
  }

  async delete(id: string, session: ClientSession): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const deleted = await this.commentModel
      .findOneAndDelete({ _id }, { session })
      .lean<LeanComment>()
      .exec();
    if (!deleted) return false;
    if (deleted.isHidden !== true) {
      await this.cascade.adjustCommentCount(deleted.postId, -1, session);
    }
    return true;
  }

  /** Parent exists, is published, not hidden, and its author is not deactivated. */
  private async parentVisible(
    postId: Types.ObjectId | undefined,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!postId) return false;
    const post = await this.postModel
      .findById(postId, { authorId: 1, status: 1, isHidden: 1 })
      .session(session ?? null)
      .lean<LeanPost>()
      .exec();
    if (!post || post.status !== POST_STATUS.PUBLISHED || post.isHidden) {
      return false;
    }
    if (!post.authorId) return true;
    const author = await this.userModel
      .findById(post.authorId, { status: 1 })
      .session(session ?? null)
      .lean<{ status?: string }>()
      .exec();
    return author?.status !== AccountStatus.DEACTIVATED;
  }
}

/** Replaces the raw GEN-09 defaults for posts and comments at startup. */
@Injectable()
export class BlogModerationHandlers implements OnModuleInit {
  constructor(
    private readonly registry: ModerationRegistry,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(Comment.name) private readonly commentModel: Model<Comment>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly cascade: BlogCascadeService,
    private readonly imageCleaner: BlogImageCleaner,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'post',
      new PostModerationHandler(this.postModel, this.cascade, this.imageCleaner),
    );
    this.registry.register(
      'comment',
      new CommentModerationHandler(
        this.commentModel,
        this.postModel,
        this.userModel,
        this.cascade,
      ),
    );
  }
}
