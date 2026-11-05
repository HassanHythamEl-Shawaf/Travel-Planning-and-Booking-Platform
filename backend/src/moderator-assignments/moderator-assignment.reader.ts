import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import type {
  ModeratorAssignment as AssignmentForGuard,
  ProviderAssignmentReader,
} from '../auth/provider-assignment.reader';
import {
  PROVIDER_DIRECTORY,
  type ProviderDirectory,
} from '../integrations/provider-directory';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';

/**
 * Implements Hassan's ProviderAssignmentReader for ProviderOwnershipGuard.
 * Returns null (so the guard answers 403) when there is no assignment or the
 * assigned provider is missing or deactivated (ACC-15, D16).
 */
@Injectable()
export class MongoModeratorAssignmentReader implements ProviderAssignmentReader {
  constructor(
    @InjectModel(ModeratorAssignment.name)
    private readonly assignmentModel: Model<ModeratorAssignment>,
    @Inject(PROVIDER_DIRECTORY)
    private readonly providers: ProviderDirectory,
  ) {}

  async findByModeratorId(
    moderatorId: string,
  ): Promise<AssignmentForGuard | null> {
    if (!Types.ObjectId.isValid(moderatorId)) return null;

    const assignment = await this.assignmentModel
      .findOne({ moderatorId: new Types.ObjectId(moderatorId) })
      .lean()
      .exec();
    if (!assignment) return null;

    const providerId = assignment.providerId.toString();
    const provider = await this.providers.find(
      assignment.providerType,
      providerId,
    );
    if (!provider || !provider.isActive) return null;

    // The guard compares strings, so ids are returned as strings (D3).
    return {
      moderatorId: assignment.moderatorId.toString(),
      providerType: assignment.providerType,
      providerId,
    };
  }
}
