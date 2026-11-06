import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { AccountStatus, User } from '../users/schemas/user.schema';
import { createDefaultHandlers } from './default-handlers';
import type {
  ContentType,
  ModerationHandler,
  ModeratableContent,
} from './moderation.types';

/**
 * One moderation handler per reportable content type (GEN-09 / GEN-10).
 *
 * Until a content owner registers a handler, a default one over the raw
 * collection is used (names in `integrations/teammate-contracts.ts`). The
 * defaults support find + hide/unhide for every type, and delete for posts
 * and comments only; admin delete of reviews and itineraries answers 501
 * until their owners register a handler with `delete`.
 *
 * @example
 * // reviews.module.ts: imports: [ModerationModule, ...]
 * @Injectable()
 * export class ReviewsService implements OnModuleInit {
 *   constructor(
 *     private readonly moderationRegistry: ModerationRegistry,
 *     @InjectModel(Review.name) private readonly reviewModel: Model<Review>,
 *   ) {}
 *
 *   onModuleInit() {
 *     this.moderationRegistry.register('review', {
 *       find: async (id, session) => {
 *         const review = await this.reviewModel.findById(id).session(session ?? null).lean();
 *         if (!review) return null;
 *         return {
 *           id, type: 'review', authorId: review.userId.toString(),
 *           isHidden: review.isHidden,
 *           publiclyVisible: !review.isHidden,
 *           snapshot: { excerpt: review.comment.slice(0, 200) },
 *         };
 *       },
 *       // Conditional on the current state; recompute the hotel rating here.
 *       setHidden: async (id, hidden, session) => {
 *         const res = await this.reviewModel.updateOne(
 *           { _id: id, isHidden: !hidden }, { isHidden: hidden }, { session });
 *         if (res.modifiedCount === 1) await this.recomputeRating(id, session);
 *         return res.modifiedCount === 1;
 *       },
 *       delete: async (id, session) => { ... return deleted; },
 *     });
 *   }
 * }
 *
 * Every method receives the admin action's transaction session: do all
 * writes with it, and never send notifications from a handler.
 */
@Injectable()
export class ModerationRegistry {
  private readonly defaults: Record<ContentType, ModerationHandler>;
  private readonly owners = new Map<ContentType, ModerationHandler>();

  constructor(
    @InjectConnection() connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {
    this.defaults = createDefaultHandlers(connection);
  }

  /** The owner's handler replaces the default for that type. */
  register(type: ContentType, handler: ModerationHandler): void {
    this.owners.set(type, handler);
  }

  get(type: ContentType): ModerationHandler {
    return this.owners.get(type) ?? this.defaults[type];
  }

  /**
   * The content as a regular user may see it: null unless it is publicly
   * visible and its author is not deactivated. Content of suspended authors
   * stays visible (ACC-16).
   */
  async findVisible(
    type: ContentType,
    id: string,
  ): Promise<ModeratableContent | null> {
    const content = await this.get(type).find(id);
    if (!content || !content.publiclyVisible) return null;
    if (await this.isDeactivated(content.authorId)) return null;
    return content;
  }

  private async isDeactivated(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return false;
    const found = await this.userModel
      .exists({
        _id: new Types.ObjectId(userId),
        status: AccountStatus.DEACTIVATED,
      })
      .exec();
    return found !== null;
  }
}
