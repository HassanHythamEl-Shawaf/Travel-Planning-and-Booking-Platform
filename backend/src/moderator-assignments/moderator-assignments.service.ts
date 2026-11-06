import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import type { ProviderType } from '../auth/decorators/provider-ownership.decorator';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';

export interface AssignmentView {
  moderatorId: string;
  providerType: ProviderType;
  providerId: string;
  assignedBy: string;
  createdAt: Date;
}

export interface CreateAssignmentInput {
  moderatorId: string;
  providerType: ProviderType;
  providerId: string;
  assignedBy: string;
}

@Injectable()
export class ModeratorAssignmentsService {
  constructor(
    @InjectModel(ModeratorAssignment.name)
    private readonly assignmentModel: Model<ModeratorAssignment>,
  ) {}

  async create(
    input: CreateAssignmentInput,
    session?: ClientSession,
  ): Promise<AssignmentView> {
    const [doc] = await this.assignmentModel.create(
      [
        {
          moderatorId: new Types.ObjectId(input.moderatorId),
          providerType: input.providerType,
          providerId: new Types.ObjectId(input.providerId),
          assignedBy: new Types.ObjectId(input.assignedBy),
        },
      ],
      { session },
    );
    return toView(doc);
  }

  async findByModeratorId(moderatorId: string): Promise<AssignmentView | null> {
    if (!Types.ObjectId.isValid(moderatorId)) return null;
    const doc = await this.assignmentModel
      .findOne({ moderatorId: new Types.ObjectId(moderatorId) })
      .lean()
      .exec();
    return doc ? toView(doc) : null;
  }

  /** One `$in` query for a page of moderators, keyed by moderator id. */
  async findByModeratorIds(
    moderatorIds: string[],
  ): Promise<Map<string, AssignmentView>> {
    const ids = moderatorIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const docs = await this.assignmentModel
      .find({ moderatorId: { $in: ids } })
      .lean()
      .exec();
    return new Map(
      docs.map((doc) => [doc.moderatorId.toString(), toView(doc)]),
    );
  }

  async findModeratorIdsForProvider(
    providerType: ProviderType,
    providerId: string,
  ): Promise<string[]> {
    if (!Types.ObjectId.isValid(providerId)) return [];
    const docs = await this.assignmentModel
      .find(
        { providerType, providerId: new Types.ObjectId(providerId) },
        { moderatorId: 1 },
      )
      .lean()
      .exec();
    return docs.map((doc) => doc.moderatorId.toString());
  }
}

function toView(doc: {
  moderatorId: Types.ObjectId;
  providerType: ProviderType;
  providerId: Types.ObjectId;
  assignedBy: Types.ObjectId;
  createdAt: Date;
}): AssignmentView {
  return {
    moderatorId: doc.moderatorId.toString(),
    providerType: doc.providerType,
    providerId: doc.providerId.toString(),
    assignedBy: doc.assignedBy.toString(),
    createdAt: doc.createdAt,
  };
}
