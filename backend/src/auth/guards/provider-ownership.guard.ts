import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { UserRole } from '../../users/schemas/user.schema';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import {
  ProviderOwnershipOptions,
  PROVIDER_OWNERSHIP_KEY,
} from '../decorators/provider-ownership.decorator';
import { PROVIDER_ASSIGNMENT_READER } from '../provider-assignment.reader';
import type { ProviderAssignmentReader } from '../provider-assignment.reader';

interface ProviderRequest extends Request {
  user?: AuthenticatedUser;
  params: Record<string, string>;
}

@Injectable()
export class ProviderOwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(PROVIDER_ASSIGNMENT_READER)
    private readonly assignments?: ProviderAssignmentReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ProviderOwnershipOptions>(
      PROVIDER_OWNERSHIP_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      throw new ServiceUnavailableException(
        'Provider ownership metadata is not configured',
      );
    }

    const request = context.switchToHttp().getRequest<ProviderRequest>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.role === UserRole.ADMIN) {
      return true;
    }

    if (user.role !== UserRole.MODERATOR) {
      throw new ForbiddenException(
        'You do not have permission to access this provider',
      );
    }

    if (!this.assignments) {
      throw new ServiceUnavailableException(
        'Moderator assignment integration is not configured',
      );
    }

    const providerId = request.params[options.providerIdParam];

    if (!providerId) {
      throw new ForbiddenException('Provider identifier is required');
    }

    const assignment = await this.assignments.findByModeratorId(user.sub);

    if (
      !assignment ||
      assignment.providerType !== options.providerType ||
      assignment.providerId !== providerId
    ) {
      throw new ForbiddenException(
        'You do not have permission to access this provider',
      );
    }

    return true;
  }
}
