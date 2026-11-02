import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { UserRole } from '../../users/schemas/user.schema';
import { ProviderOwnershipOptions } from '../decorators/provider-ownership.decorator';
import { ProviderAssignmentReader } from '../provider-assignment.reader';
import { ProviderOwnershipGuard } from './provider-ownership.guard';

describe('ProviderOwnershipGuard', () => {
  const handler = () => undefined;
  const controllerClass = class ProviderController {};
  const options: ProviderOwnershipOptions = {
    providerType: 'airline',
    providerIdParam: 'airlineId',
  };
  const request = {
    user: { sub: 'moderator-id', role: UserRole.MODERATOR },
    params: { airlineId: 'airline-id' },
  };

  let guard: ProviderOwnershipGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;
  let assignments: jest.Mocked<
    Pick<ProviderAssignmentReader, 'findByModeratorId'>
  >;

  const context = (): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as ExecutionContext;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(options),
    };
    assignments = {
      findByModeratorId: jest.fn().mockResolvedValue({
        moderatorId: 'moderator-id',
        providerType: 'airline',
        providerId: 'airline-id',
      }),
    };
    guard = new ProviderOwnershipGuard(
      reflector as Reflector,
      assignments as ProviderAssignmentReader,
    );
  });

  it('allows an assigned moderator', async () => {
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(assignments.findByModeratorId).toHaveBeenCalledWith('moderator-id');
  });

  it('rejects a moderator assigned to a different provider', async () => {
    assignments.findByModeratorId.mockResolvedValue({
      moderatorId: 'moderator-id',
      providerType: 'hotel',
      providerId: 'hotel-id',
    });

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed until the assignment integration is registered', async () => {
    guard = new ProviderOwnershipGuard(reflector as Reflector);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('fails closed when the provider requirement is not declared', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('allows an admin without querying moderator assignments', async () => {
    request.user.role = UserRole.ADMIN;

    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(assignments.findByModeratorId).not.toHaveBeenCalled();

    request.user.role = UserRole.MODERATOR;
  });
});
