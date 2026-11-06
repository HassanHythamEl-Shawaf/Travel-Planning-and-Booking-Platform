import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, PipelineStage, Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { Pagination } from '../common/pagination';
import { containsInsensitive } from '../common/regex';
import {
  POST_STATUS,
  USERS_COLLECTION,
} from '../integrations/teammate-contracts';
import { toExcerpt } from '../moderation/moderation.types';
import { AccountStatus, User } from '../users/schemas/user.schema';
import { BlogCascadeService } from './blog-cascade.service';
import { BlogImageCleaner } from './blog-image-cleaner';
import { DELETED_BY_AUTHOR_NOTE, type PostStatus } from './blog.constants';
import {
  canViewPost,
  isAdmin,
  isAuthorOf,
  type Viewer,
} from './blog-visibility';
import {
  CreatePostDto,
  DeletedDto,
  MyPostListItemDto,
  PaginatedMyPostsDto,
  PaginatedPostsDto,
  PostDetailDto,
  PostListItemDto,
  UpdatePostDto,
} from './dto/post.dto';
import { Like } from './schemas/like.schema';
import { Post } from './schemas/post.schema';
import { normalizeTag, normalizeTags } from './tags';

export type LeanPost = Post & { _id: Types.ObjectId };

export interface AuthorInfo {
  _id: Types.ObjectId;
  name: string;
  status: AccountStatus;
  createdAt?: Date;
}

export interface PublishedPostFilters {
  q?: string;
  tag?: string;
  authorId?: string;
}

/** The fields of a post the list items need. */
const LIST_PROJECTION = {
  title: 1,
  content: 1,
  tags: 1,
  images: { $slice: ['$images', 1] },
  likeCount: 1,
  commentCount: 1,
  publishedAt: 1,
  author: { _id: 1, name: 1 },
} as const;

/**
 * Published, visible posts in the D8 order (likes + comments desc, newest
 * first, then _id), one page plus the total. `match` is applied before the
 * author lookup; `q` (BLG-09) is matched literally against the title, tags
 * and author name, and posts of deactivated authors are dropped (D4).
 */
export function buildPublishedPostsPipeline(
  match: Record<string, unknown>,
  q: string | undefined,
  page: Pagination,
): PipelineStage[] {
  const keyword = q ? containsInsensitive(q) : null;
  return [
    {
      $match: {
        ...match,
        status: POST_STATUS.PUBLISHED,
        isHidden: { $ne: true },
      },
    },
    {
      $lookup: {
        from: USERS_COLLECTION,
        localField: 'authorId',
        foreignField: '_id',
        pipeline: [{ $project: { name: 1, status: 1 } }],
        as: 'author',
      },
    },
    { $unwind: '$author' },
    {
      $match: {
        'author.status': { $ne: AccountStatus.DEACTIVATED },
        ...(keyword && {
          $or: [
            { title: keyword },
            { tags: keyword },
            { 'author.name': keyword },
          ],
        }),
      },
    },
    {
      $addFields: {
        score: {
          $add: [
            { $ifNull: ['$likeCount', 0] },
            { $ifNull: ['$commentCount', 0] },
          ],
        },
      },
    },
    { $sort: { score: -1, publishedAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: page.skip },
          { $limit: page.limit },
          { $project: LIST_PROJECTION },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];
}

type ListRow = Pick<
  LeanPost,
  '_id' | 'title' | 'content' | 'tags' | 'images' | 'publishedAt'
> &
  Partial<Pick<LeanPost, 'likeCount' | 'commentCount'>> & {
    author?: { _id: Types.ObjectId; name: string } | null;
  };

/** BLG-01 – BLG-04, BLG-08, BLG-09. */
@Injectable()
export class PostsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Like.name) private readonly likeModel: Model<Like>,
    private readonly cascade: BlogCascadeService,
    private readonly imageCleaner: BlogImageCleaner,
  ) {}

  // -------------------------------------------------------------- writes

  async create(
    viewer: AuthenticatedUser,
    dto: CreatePostDto,
  ): Promise<PostDetailDto> {
    const status = dto.status ?? POST_STATUS.DRAFT;
    const created = await this.postModel.create({
      authorId: new Types.ObjectId(viewer.sub),
      title: dto.title,
      content: dto.content,
      tags: normalizeTags(dto.tags ?? []),
      status,
      publishedAt: status === POST_STATUS.PUBLISHED ? new Date() : null,
    });
    const author = await this.findAuthor(created.authorId);
    return this.toDetail(created.toObject() as LeanPost, author, viewer, false);
  }

  async update(
    id: string,
    viewer: AuthenticatedUser,
    dto: UpdatePostDto,
  ): Promise<PostDetailDto> {
    const { post, author } = await this.loadOwned(id, viewer);

    const set: Partial<Post> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.content !== undefined) set.content = dto.content;
    if (dto.tags !== undefined) set.tags = normalizeTags(dto.tags);
    if (dto.status !== undefined) set.status = dto.status;
    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    let updated = await this.postModel
      .findOneAndUpdate(
        { _id: post._id, authorId: post.authorId },
        { $set: set },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<LeanPost>()
      .exec();
    if (!updated) throw new NotFoundException('Post not found');

    // publishedAt is set on the first publish only (D3).
    if (updated.status === POST_STATUS.PUBLISHED && !updated.publishedAt) {
      updated =
        (await this.postModel
          .findOneAndUpdate(
            { _id: post._id, publishedAt: null },
            { $set: { publishedAt: new Date() } },
            { returnDocument: 'after' },
          )
          .lean<LeanPost>()
          .exec()) ?? updated;
    }

    const likedByMe = await this.likedBy(updated._id, viewer);
    return this.toDetail(updated, author, viewer, likedByMe);
  }

  /**
   * Hard delete (D6): the post, its comments and likes, and open reports on
   * any of them closed as content_deleted, in one transaction. Image files
   * are removed after the commit (best effort).
   */
  async remove(id: string, viewer: AuthenticatedUser): Promise<DeletedDto> {
    const { post } = await this.loadOwned(id, viewer);

    await this.connection.transaction(async (session) => {
      const result = await this.postModel
        .deleteOne({ _id: post._id, authorId: post.authorId }, { session })
        .exec();
      if (result.deletedCount !== 1) {
        throw new NotFoundException('Post not found');
      }
      const commentIds = await this.cascade.deletePostChildren(
        post._id,
        session,
      );
      await this.cascade.closeOpenReports(
        [
          { type: 'post', ids: [post._id] },
          { type: 'comment', ids: commentIds },
        ],
        DELETED_BY_AUTHOR_NOTE,
        session,
      );
    });

    await this.imageCleaner.deleteFiles(
      (post.images ?? []).map((i) => i.imageId),
    );
    return { id, deleted: true };
  }

  // --------------------------------------------------------------- reads

  async findOne(id: string, viewer: Viewer): Promise<PostDetailDto> {
    const { post, author } = await this.loadViewable(id, viewer);
    const likedByMe = await this.likedBy(post._id, viewer);
    return this.toDetail(post, author, viewer, likedByMe);
  }

  /** GET /posts and GET /tags/:tag/posts (BLG-02, BLG-08, BLG-09). */
  async listPublished(
    filters: PublishedPostFilters,
    page: Pagination,
  ): Promise<PaginatedPostsDto> {
    const match: Record<string, unknown> = {};
    if (filters.tag !== undefined) match.tags = normalizeTag(filters.tag);
    if (filters.authorId) {
      match.authorId = new Types.ObjectId(filters.authorId);
    }
    const q = filters.q?.trim() || undefined;

    const [result] = await this.postModel
      .aggregate<{ items: ListRow[]; total: { count: number }[] }>(
        buildPublishedPostsPipeline(match, q, page),
      )
      .exec();
    const total = result?.total[0]?.count ?? 0;
    return {
      items: (result?.items ?? []).map((row) => this.toListItem(row)),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  /** BLG-03 / D5: both statuses, hidden included, most recently updated first. */
  async listMine(
    viewer: AuthenticatedUser,
    status: PostStatus | undefined,
    page: Pagination,
  ): Promise<PaginatedMyPostsDto> {
    const authorId = new Types.ObjectId(viewer.sub);
    const filter = { authorId, ...(status && { status }) };
    const [docs, total, me] = await Promise.all([
      this.postModel
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean<LeanPost[]>()
        .exec(),
      this.postModel.countDocuments(filter).exec(),
      this.findAuthor(authorId),
    ]);
    const author = me ? { _id: me._id, name: me.name } : null;

    return {
      items: docs.map(
        (post): MyPostListItemDto => ({
          ...this.toListItem({ ...post, author }),
          status: post.status,
          isHidden: post.isHidden === true,
          createdAt: post.createdAt,
          updatedAt: post.updatedAt,
        }),
      ),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  // ------------------------------------------------------------- helpers

  /** The post and its author if the viewer may see it (D4), otherwise 404. */
  async loadViewable(
    id: string,
    viewer: Viewer,
  ): Promise<{ post: LeanPost; author: AuthorInfo | null }> {
    const post = await this.postModel.findById(id).lean<LeanPost>().exec();
    if (!post) throw new NotFoundException('Post not found');
    const author = await this.findAuthor(post.authorId);
    if (!canViewPost(post, author, viewer)) {
      throw new NotFoundException('Post not found');
    }
    return { post, author };
  }

  /**
   * For author-only actions: 404 if the viewer cannot see the post, 403 if
   * they can see it but are not its author.
   */
  async loadOwned(
    id: string,
    viewer: AuthenticatedUser,
  ): Promise<{ post: LeanPost; author: AuthorInfo | null }> {
    const post = await this.postModel.findById(id).lean<LeanPost>().exec();
    if (!post) throw new NotFoundException('Post not found');
    const author = await this.findAuthor(post.authorId);
    if (!isAuthorOf(post, viewer)) {
      if (canViewPost(post, author, viewer)) {
        throw new ForbiddenException('Only the author can change this post');
      }
      throw new NotFoundException('Post not found');
    }
    return { post, author };
  }

  async findAuthor(id: Types.ObjectId): Promise<AuthorInfo | null> {
    return this.userModel
      .findById(id, { name: 1, status: 1, createdAt: 1 })
      .lean<AuthorInfo>()
      .exec();
  }

  /** Whether the viewer liked the post (BLG-06); false for guests. */
  private async likedBy(
    postId: Types.ObjectId,
    viewer: Viewer,
  ): Promise<boolean> {
    if (!viewer) return false;
    const like = await this.likeModel
      .exists({ postId, userId: new Types.ObjectId(viewer.sub) })
      .exec();
    return like !== null;
  }

  toListItem(row: ListRow): PostListItemDto {
    return {
      id: row._id.toString(),
      title: row.title,
      excerpt: toExcerpt(row.content),
      tags: row.tags ?? [],
      author: {
        id: row.author ? row.author._id.toString() : null,
        name: row.author?.name ?? '',
      },
      coverImage: row.images?.[0]?.url ?? null,
      likeCount: row.likeCount ?? 0,
      commentCount: row.commentCount ?? 0,
      publishedAt: row.publishedAt ?? null,
    };
  }

  toDetail(
    post: LeanPost,
    author: AuthorInfo | null,
    viewer: Viewer,
    likedByMe: boolean,
  ): PostDetailDto {
    const isOwner = isAuthorOf(post, viewer);
    const privileged = isOwner || isAdmin(viewer);
    return {
      ...this.toListItem({
        ...post,
        author: author ? { _id: author._id, name: author.name } : null,
      }),
      content: post.content,
      images: (post.images ?? []).map((i) => ({
        imageId: i.imageId,
        url: i.url,
      })),
      ...(privileged && {
        status: post.status,
        isHidden: post.isHidden === true,
      }),
      likedByMe,
      isOwner,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }
}
