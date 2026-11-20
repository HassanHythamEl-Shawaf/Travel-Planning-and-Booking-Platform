import type { Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';

/** The logged-in user, or undefined for a guest. */
export type Viewer = AuthenticatedUser | undefined;

export interface AccessItinerary {
  ownerId: Types.ObjectId | string;
  isPublic?: boolean;
  isHidden?: boolean;
}

/** Only `status` matters; a missing owner counts as deactivated. */
export interface AccessOwner {
  status?: string;
}

export const isAdmin = (viewer: Viewer): boolean =>
  viewer?.role === UserRole.ADMIN;

export const isOwnerOf = (
  itinerary: AccessItinerary,
  viewer: Viewer,
): boolean => !!viewer && viewer.sub === itinerary.ownerId.toString();

export const isDeactivated = (owner: AccessOwner | null | undefined): boolean =>
  !owner || owner.status === AccountStatus.DEACTIVATED;

/**
 * Who can see an itinerary (spec D5, ACC-11, ACC-12, GEN-10):
 * - the owner always;
 * - private: nobody else (admins too get 404);
 * - public but owner deactivated: admins only;
 * - public but hidden by an admin: admins only (and the owner);
 * - otherwise public: everyone, guests included, read-only.
 */
export function canViewItinerary(
  itinerary: AccessItinerary,
  owner: AccessOwner | null | undefined,
  viewer: Viewer,
): boolean {
  if (isOwnerOf(itinerary, viewer)) return true;
  if (itinerary.isPublic !== true) return false;
  if (isDeactivated(owner)) return isAdmin(viewer);
  if (itinerary.isHidden === true) return isAdmin(viewer);
  return true;
}
