import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';

import { ProviderOwnership } from '../auth/decorators/provider-ownership.decorator';
import { ProviderOwnershipGuard } from '../auth/guards/provider-ownership.guard';
import { PROVIDER_ASSIGNMENT_READER } from '../auth/provider-assignment.reader';
import {
  PROVIDER_DIRECTORY,
  type ProviderDirectory,
} from '../integrations/provider-directory';
import { UserRole } from '../users/schemas/user.schema';
import { MongoModeratorAssignmentReader } from './moderator-assignment.reader';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';

class AirlineController {
  @ProviderOwnership('airline')
  manage() {}
}

class HotelController {
  @ProviderOwnership('hotel')
  manage() {}
}

describe("Hassan's ProviderOwnershipGuard with the real assignment reader", () => {
  const moderatorId = new Types.ObjectId().toString();
  const airlineId = new Types.ObjectId().toString();

  let guard: ProviderOwnershipGuard;
  let providers: jest.Mocked<ProviderDirectory>;
  let assignment: Record<string, unknown> | null;

  const context = (
    controller: { new (): { manage: () => void } },
    role: UserRole,
    providerId: string,
  ): ExecutionContext =>
    ({
      getHandler: () => controller.prototype.manage,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: moderatorId, role },
          params: { id: providerId },
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(async () => {
    assignment = {
      moderatorId: new Types.ObjectId(moderatorId),
      providerType: 'airline',
      providerId: new Types.ObjectId(airlineId),
    };
    providers = {
      find: jest
        .fn()
        .mockImplementation((type: string, id: string) =>
          Promise.resolve({ id, type, name: 'Test Air', isActive: true }),
        ),
      setActive: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        Reflector,
        ProviderOwnershipGuard,
        {
          provide: PROVIDER_ASSIGNMENT_READER,
          useClass: MongoModeratorAssignmentReader,
        },
        { provide: PROVIDER_DIRECTORY, useValue: providers },
        {
          provide: getModelToken(ModeratorAssignment.name),
          useValue: {
            findOne: () => ({
              lean: () => ({ exec: () => Promise.resolve(assignment) }),
            }),
          },
        },
      ],
    }).compile();

    guard = moduleRef.get(ProviderOwnershipGuard);
  });

  it('allows the assigned moderator on their own airline', async () => {
    await expect(
      guard.canActivate(
        context(AirlineController, UserRole.MODERATOR, airlineId),
      ),
    ).resolves.toBe(true);
  });

  it('rejects the moderator on a different airline', async () => {
    await expect(
      guard.canActivate(
        context(
          AirlineController,
          UserRole.MODERATOR,
          new Types.ObjectId().toString(),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the moderator on a provider of the other type', async () => {
    await expect(
      guard.canActivate(
        context(HotelController, UserRole.MODERATOR, airlineId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects the moderator once the airline is deactivated', async () => {
    providers.find.mockResolvedValue({
      id: airlineId,
      type: 'airline',
      name: 'Test Air',
      isActive: false,
    });
    await expect(
      guard.canActivate(
        context(AirlineController, UserRole.MODERATOR, airlineId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a moderator with no assignment', async () => {
    assignment = null;
    await expect(
      guard.canActivate(
        context(AirlineController, UserRole.MODERATOR, airlineId),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an admin regardless of assignment', async () => {
    assignment = null;
    await expect(
      guard.canActivate(context(AirlineController, UserRole.ADMIN, airlineId)),
    ).resolves.toBe(true);
    expect(providers.find).not.toHaveBeenCalled();
  });
});
