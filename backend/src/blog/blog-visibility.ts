import type { Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { POST_STATUS } from '../integrations/teammate-contracts';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';

/**
 * The visibility rules of D4 and D12, in one place. List queries apply the
 * same rules in their `$match` stages (see PostsService).
 */

export type Viewer = AuthenticatedUser | undefined;

export interface VisibilityPost {
  authorId: Types.ObjectId | string;
  status: string;
  isHidden?: boolean;
}

export interface VisibilityComment {
  authorId: Types.ObjectId | string;
  isHidden?: boolean;
}

/** Only `status` matters; a missing author counts as deactivated. */
export interface VisibilityAuthor {
  status?: string;
}

export const isAdmin = (viewer: Viewer): boolean =>
  viewer?.role === UserRole.ADMIN;

export const isAuthorOf = (
  item: { authorId: Types.ObjectId | string },
  viewer: Viewer,
): boolean => !!viewer && viewer.sub === item.authorId.toString();

export const isDeactivated = (
  author: VisibilityAuthor | null | undefined,
): boolean => !author || author.status === AccountStatus.DEACTIVATED;

/**
 * D4: draft → author only (admins too get 404); deactivated author → admins
 * only; hidden → author and admins; suspended author → visible as normal.
 */
export function canViewPost(
  post: VisibilityPost,
  author: VisibilityAuthor | null | undefined,
  viewer: Viewer,
): boolean {
  if (post.status !== POST_STATUS.PUBLISHED) return isAuthorOf(post, viewer);
  if (isDeactivated(author)) return isAdmin(viewer);
  if (post.isHidden === true) {
    return isAuthorOf(post, viewer) || isAdmin(viewer);
  }
  return true;
}

/**
 * D12: a comment is listed when its post is viewable; a hidden comment only
 * for its author and admins.
 */
export function canViewComment(
  comment: VisibilityComment,
  post: VisibilityPost,
  postAuthor: VisibilityAuthor | null | undefined,
  viewer: Viewer,
): boolean {
  if (!canViewPost(post, postAuthor, viewer)) return false;
  if (comment.isHidden !== true) return true;
  return isAuthorOf(comment, viewer) || isAdmin(viewer);
}

/** Published, not hidden, author not deactivated: what guests can see. */
export function isPubliclyVisible(
  post: VisibilityPost,
  author: VisibilityAuthor | null | undefined,
): boolean {
  return canViewPost(post, author, undefined);
}
