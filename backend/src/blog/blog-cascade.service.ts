import { Injectable } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { CONTENT_COLLECTIONS } from '../integrations/teammate-contracts';
import { ReportStatus } from '../reports/report.constants';
import { Report } from '../reports/schemas/report.schema';

export interface ReportTarget {
  type: 'post' | 'comment';
  ids: Types.ObjectId[];
}

/**
 * Writes shared by the author delete endpoints and the moderation handlers.
 * Every method runs inside the caller's transaction session.
 */
@Injectable()
export class BlogCascadeService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
  ) {}

  /**
   * Deletes the comments and likes of a post that was just deleted, and
   * returns the ids of the deleted comments.
   */
  async deletePostChildren(
    postId: Types.ObjectId,
    session: ClientSession,
  ): Promise<Types.ObjectId[]> {
    const comments = this.connection.collection(CONTENT_COLLECTIONS.comment);
    const found = await comments
      .find({ postId }, { session, projection: { _id: 1 } })
      .toArray();
    const commentIds = found.map((c) => c._id as Types.ObjectId);
    await comments.deleteMany({ postId }, { session });
    await this.connection
      .collection(CONTENT_COLLECTIONS.like)
      .deleteMany({ postId }, { session });
    return commentIds;
  }

  /**
   * `commentCount` counts non-hidden comments (D7). A decrement only applies
   * while the counter is positive, so it never goes below 0.
   */
  async adjustCommentCount(
    postId: Types.ObjectId,
    delta: 1 | -1,
    session: ClientSession,
  ): Promise<void> {
    const filter =
      delta < 0 ? { _id: postId, commentCount: { $gt: 0 } } : { _id: postId };
    await this.connection
      .collection(CONTENT_COLLECTIONS.post)
      .updateOne(filter, { $inc: { commentCount: delta } }, { session });
  }

  /**
   * Closes open reports on content that no longer exists as
   * `content_deleted`, with no resolving admin (D6). Reporters are not
   * notified. Returns the number of reports closed.
   */
  async closeOpenReports(
    targets: ReportTarget[],
    note: string,
    session: ClientSession,
  ): Promise<number> {
    const or = targets
      .filter((t) => t.ids.length > 0)
      .map((t) => ({ targetType: t.type, targetId: { $in: t.ids } }));
    if (or.length === 0) return 0;

    const result = await this.reportModel
      .updateMany(
        { status: ReportStatus.OPEN, $or: or },
        {
          $set: {
            status: ReportStatus.CONTENT_DELETED,
            resolvedBy: null,
            resolvedAt: new Date(),
            resolutionNote: note,
          },
        },
        { session },
      )
      .exec();
    return result.modifiedCount;
  }
}
