import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { Pagination } from '../common/pagination';
import { POST_STATUS } from '../integrations/teammate-contracts';
import { User } from '../users/schemas/user.schema';
import { BlogCascadeService } from './blog-cascade.service';
import { DELETED_BY_AUTHOR_NOTE, DELETED_USER_NAME } from './blog.constants';
import {
  canViewComment,
  isAdmin,
  isAuthorOf,
  isDeactivated,
  isPubliclyVisible,
  type Viewer,
} from './blog-visibility';
import { CommentDto, PaginatedCommentsDto } from './dto/comment.dto';
import { DeletedDto } from './dto/post.dto';
import { type LeanPost, PostsService } from './posts.service';
import { Comment } from './schemas/comment.schema';
import { Post } from './schemas/post.schema';

type LeanComment = Comment & { _id: Types.ObjectId };

interface CommentAuthor {
  _id: Types.ObjectId;
  name: string;
  status?: string;
}

/** BLG-05, BLG-07 (D11, D12). */
@Injectable()
export class CommentsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Comment.name)
    private readonly commentModel: Model<Comment>,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly posts: PostsService,
    private readonly cascade: BlogCascadeService,
  ) {}

  /** Oldest first; hidden comments only for their author and admins (D12). */
  async list(
    postId: string,
    viewer: Viewer,
    page: Pagination,
  ): Promise<PaginatedCommentsDto> {
    const { post } = await this.posts.loadViewable(postId, viewer);
    const filter = { postId: post._id, ...this.hiddenFilter(viewer) };

    const [docs, total] = await Promise.all([
      this.commentModel
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<LeanComment[]>()
        .exec(),
      this.commentModel.countDocuments(filter).exec(),
    ]);
    const authors = await this.findAuthors(docs.map((c) => c.authorId));

    return {
      items: docs.map((c) =>
        this.toDto(c, authors.get(c.authorId.toString()), viewer),
      ),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  /** Only on a published, visible post (D11); commentCount +1 in the same transaction. */
  async create(
    postId: string,
    viewer: AuthenticatedUser,
    content: string,
  ): Promise<CommentDto> {
    const { post, author } = await this.posts.loadViewable(postId, viewer);
    if (!isPubliclyVisible(post, author)) {
      throw new NotFoundException('Post not found');
    }

    const comment = await this.connection.transaction(async (session) => {
      const [created] = await this.commentModel.create(
        [
          {
            postId: post._id,
            authorId: new Types.ObjectId(viewer.sub),
            content,
          },
        ],
        { session },
      );
      // The post may have been hidden, unpublished or deleted meanwhile.
      const counted = await this.postModel
        .updateOne(
          {
            _id: post._id,
            status: POST_STATUS.PUBLISHED,
            isHidden: { $ne: true },
          },
          { $inc: { commentCount: 1 } },
          { session },
        )
        .exec();
      if (counted.matchedCount !== 1) {
        throw new NotFoundException('Post not found');
      }
      return created.toObject() as LeanComment;
    });

    const authors = await this.findAuthors([comment.authorId]);
    return this.toDto(comment, authors.get(viewer.sub), viewer);
  }

  /** BLG-07: the comment author only; sets editedAt. */
  async update(
    id: string,
    viewer: AuthenticatedUser,
    content: string,
  ): Promise<CommentDto> {
    const comment = await this.loadOwned(id, viewer);
    const updated = await this.commentModel
      .findOneAndUpdate(
        { _id: comment._id, authorId: comment.authorId },
        { $set: { content, editedAt: new Date() } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<LeanComment>()
      .exec();
    if (!updated) throw new NotFoundException('Comment not found');

    const authors = await this.findAuthors([updated.authorId]);
    return this.toDto(updated, authors.get(viewer.sub), viewer);
  }

  /**
   * BLG-07 / D6: deletes the comment, decrements commentCount if it was
   * visible, and closes its open reports, in one transaction.
   */
  async remove(id: string, viewer: AuthenticatedUser): Promise<DeletedDto> {
    const comment = await this.loadOwned(id, viewer);

    await this.connection.transaction(async (session) => {
      const deleted = await this.commentModel
        .findOneAndDelete(
          { _id: comment._id, authorId: comment.authorId },
          { session },
        )
        .lean<LeanComment>()
        .exec();
      if (!deleted) throw new NotFoundException('Comment not found');
      if (deleted.isHidden !== true) {
        await this.cascade.adjustCommentCount(deleted.postId, -1, session);
      }
      await this.cascade.closeOpenReports(
        [{ type: 'comment', ids: [deleted._id] }],
        DELETED_BY_AUTHOR_NOTE,
        session,
      );
    });

    return { id, deleted: true };
  }

  // ------------------------------------------------------------- helpers

  private hiddenFilter(viewer: Viewer): Record<string, unknown> {
    if (isAdmin(viewer)) return {};
    if (viewer) {
      return {
        $or: [
          { isHidden: { $ne: true } },
          { authorId: new Types.ObjectId(viewer.sub) },
        ],
      };
    }
    return { isHidden: { $ne: true } };
  }

  /**
   * The author can always edit or delete their own comment, even if the
   * post was hidden or set back to draft (D11). Others get 403 if they can
   * see the comment, 404 otherwise.
   */
  private async loadOwned(
    id: string,
    viewer: AuthenticatedUser,
  ): Promise<LeanComment> {
    const comment = await this.commentModel
      .findById(id)
      .lean<LeanComment>()
      .exec();
    if (!comment) throw new NotFoundException('Comment not found');
    if (isAuthorOf(comment, viewer)) return comment;

    const post = await this.postModel
      .findById(comment.postId)
      .lean<LeanPost>()
      .exec();
    const postAuthor = post ? await this.posts.findAuthor(post.authorId) : null;
    if (post && canViewComment(comment, post, postAuthor, viewer)) {
      throw new ForbiddenException('Only its author can change this comment');
    }
    throw new NotFoundException('Comment not found');
  }

  private async findAuthors(
    ids: Types.ObjectId[],
  ): Promise<Map<string, CommentAuthor>> {
    if (ids.length === 0) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: ids } }, { name: 1, status: 1 })
      .lean<CommentAuthor[]>()
      .exec();
    return new Map(users.map((u) => [u._id.toString(), u]));
  }

  private toDto(
    comment: LeanComment,
    author: CommentAuthor | undefined,
    viewer: Viewer,
  ): CommentDto {
    const isOwner = isAuthorOf(comment, viewer);
    // D12: the comment stays, its deactivated author is anonymised.
    const shown = isDeactivated(author)
      ? { id: null, name: DELETED_USER_NAME }
      : { id: author!._id.toString(), name: author!.name };
    return {
      id: comment._id.toString(),
      content: comment.content,
      author: shown,
      createdAt: comment.createdAt,
      editedAt: comment.editedAt ?? null,
      isOwner,
      ...((isOwner || isAdmin(viewer)) && {
        isHidden: comment.isHidden === true,
      }),
    };
  }
}
