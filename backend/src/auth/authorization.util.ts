import { ForbiddenException } from '@nestjs/common';

import { UserRole } from '../users/schemas/user.schema';

export function assertOwnerOrAdmin(
  requestingUserId: string,
  resourceOwnerId: string,
  role: UserRole,
): void {
  const isOwner = requestingUserId === resourceOwnerId;
  const isAdmin = role === UserRole.ADMIN;

  if (!isOwner && !isAdmin) {
    throw new ForbiddenException(
      'You do not have permission to access this resource',
    );
  }
}
