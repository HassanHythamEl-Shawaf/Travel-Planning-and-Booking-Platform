import type { ClientSession, Connection } from 'mongoose';
import { Types } from 'mongoose';

import {
  CONTENT_COLLECTIONS,
  POST_STATUS,
  USERS_COLLECTION,
} from '../integrations/teammate-contracts';
import { AccountStatus } from '../users/schemas/user.schema';
import {
  type ContentType,
  type ModerationHandler,
  type ModeratableContent,
  toExcerpt,
} from './moderation.types';

/**
 * Fallback handlers over the raw collections named in teammate-contracts.ts,
 * used until a content owner registers a real handler. They never depend on
 * teammates' schemas: a missing collection simply yields null / false.
 */

interface PostDoc {
  _id: Types.ObjectId;
  authorId?: Types.ObjectId;
  title?: string;
  content?: string;
  status?: string;
  isHidden?: boolean;
}

interface CommentDoc {
  _id: Types.ObjectId;
  postId?: Types.ObjectId;
  authorId?: Types.ObjectId;
  content?: string;
  isHidden?: boolean;
}

interface ReviewDoc {
  _id: Types.ObjectId;
  userId?: Types.ObjectId;
  comment?: string;
  isHidden?: boolean;
}

interface ItineraryDoc {
  _id: Types.ObjectId;
  ownerId?: Types.ObjectId;
  title?: string;
  isPublic?: boolean;
  isHidden?: boolean;
}

interface UserStatusDoc {
  _id: Types.ObjectId;
  status?: string;
}

const toObjectId = (id: string): Types.ObjectId | null =>
  Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id)
    ? new Types.ObjectId(id)
    : null;

const idString = (id: Types.ObjectId | undefined): string =>
  id ? id.toString() : '';

/** Base: conditional isHidden update on one collection. */
abstract class RawCollectionHandler<TDoc extends { _id: Types.ObjectId }>
  implements ModerationHandler
{
  protected abstract readonly type: ContentType;

  constructor(
    protected readonly connection: Connection,
    private readonly collectionName: string,
  ) {}

  protected collection() {
    return this.connection.collection<TDoc>(this.collectionName);
  }

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const doc = (await this.collection().findOne(
      { _id } as never,
      { session },
    )) as TDoc | null;
    return doc ? this.toContent(doc, session) : null;
  }

  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    // A missing isHidden counts as visible.
    const result = await this.collection().updateOne(
      { _id, isHidden: hidden ? { $ne: true } : true } as never,
      { $set: { isHidden: hidden } } as never,
      { session },
    );
    return result.modifiedCount === 1;
  }

  protected abstract toContent(
    doc: TDoc,
    session?: ClientSession,
  ): Promise<ModeratableContent> | ModeratableContent;
}

export class DefaultPostHandler extends RawCollectionHandler<PostDoc> {
  protected readonly type = 'post' as const;

  constructor(connection: Connection) {
    super(connection, CONTENT_COLLECTIONS.post);
  }

  protected toContent(doc: PostDoc): ModeratableContent {
    const isHidden = doc.isHidden === true;
    return {
      id: doc._id.toString(),
      type: this.type,
      authorId: idString(doc.authorId),
      isHidden,
      publiclyVisible: doc.status === POST_STATUS.PUBLISHED && !isHidden,
      snapshot: { title: doc.title, excerpt: toExcerpt(doc.content) },
    };
  }

  /** Deletes the post with its comments and likes, in the caller's session. */
  async delete(id: string, session: ClientSession): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.collection().deleteOne({ _id }, { session });
    if (result.deletedCount !== 1) return false;
    await this.connection
      .collection(CONTENT_COLLECTIONS.comment)
      .deleteMany({ postId: _id }, { session });
    await this.connection
      .collection(CONTENT_COLLECTIONS.like)
      .deleteMany({ postId: _id }, { session });
    return true;
  }
}

export class DefaultCommentHandler extends RawCollectionHandler<CommentDoc> {
  protected readonly type = 'comment' as const;

  constructor(connection: Connection) {
    super(connection, CONTENT_COLLECTIONS.comment);
  }

  protected async toContent(
    doc: CommentDoc,
    session?: ClientSession,
  ): Promise<ModeratableContent> {
    const isHidden = doc.isHidden === true;
    return {
      id: doc._id.toString(),
      type: this.type,
      authorId: idString(doc.authorId),
      isHidden,
      publiclyVisible: !isHidden && (await this.parentVisible(doc, session)),
      snapshot: { excerpt: toExcerpt(doc.content) },
    };
  }

  /** Parent post exists, is published, not hidden, and its author is not deactivated. */
  private async parentVisible(
    doc: CommentDoc,
    session?: ClientSession,
  ): Promise<boolean> {
    if (!doc.postId) return false;
    const post = await this.connection
      .collection<PostDoc>(CONTENT_COLLECTIONS.post)
      .findOne(
        { _id: doc.postId },
        { session, projection: { authorId: 1, status: 1, isHidden: 1 } },
      );
    if (!post || post.status !== POST_STATUS.PUBLISHED || post.isHidden) {
      return false;
    }
    if (!post.authorId) return true;
    const author = await this.connection
      .collection<UserStatusDoc>(USERS_COLLECTION)
      .findOne(
        { _id: post.authorId },
        { session, projection: { status: 1 } },
      );
    return author?.status !== AccountStatus.DEACTIVATED;
  }

  async delete(id: string, session: ClientSession): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.collection().deleteOne({ _id }, { session });
    return result.deletedCount === 1;
  }
}

/** No delete: Yassin's handler must also recompute the hotel rating. */
export class DefaultReviewHandler extends RawCollectionHandler<ReviewDoc> {
  protected readonly type = 'review' as const;

  constructor(connection: Connection) {
    super(connection, CONTENT_COLLECTIONS.review);
  }

  protected toContent(doc: ReviewDoc): ModeratableContent {
    const isHidden = doc.isHidden === true;
    return {
      id: doc._id.toString(),
      type: this.type,
      authorId: idString(doc.userId),
      isHidden,
      publiclyVisible: !isHidden,
      snapshot: { excerpt: toExcerpt(doc.comment) },
    };
  }
}

/** No delete: Hammad's handler must also remove activity images. */
export class DefaultItineraryHandler extends RawCollectionHandler<ItineraryDoc> {
  protected readonly type = 'itinerary' as const;

  constructor(connection: Connection) {
    super(connection, CONTENT_COLLECTIONS.itinerary);
  }

  protected toContent(doc: ItineraryDoc): ModeratableContent {
    const isHidden = doc.isHidden === true;
    return {
      id: doc._id.toString(),
      type: this.type,
      authorId: idString(doc.ownerId),
      isHidden,
      publiclyVisible: doc.isPublic === true && !isHidden,
      // The contract has no free-text field for itineraries; the title is the excerpt.
      snapshot: { title: doc.title, excerpt: toExcerpt(doc.title) },
    };
  }
}

export function createDefaultHandlers(
  connection: Connection,
): Record<ContentType, ModerationHandler> {
  return {
    post: new DefaultPostHandler(connection),
    comment: new DefaultCommentHandler(connection),
    review: new DefaultReviewHandler(connection),
    itinerary: new DefaultItineraryHandler(connection),
  };
}
