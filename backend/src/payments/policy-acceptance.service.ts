import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { PolicyAcceptance } from './policy-acceptance.schema';

@Injectable()
export class PolicyAcceptanceService {
  constructor(
    @InjectModel(PolicyAcceptance.name)
    private readonly model: Model<PolicyAcceptance>,
  ) {}

  async getAcceptedPolicy(
    bookingType: 'flight' | 'hotel',
    bookingId: string,
    userId: string,
  ) {
    const acceptance = await this.model
      .findOne({ bookingType, bookingId, userId: new Types.ObjectId(userId) })
      .lean()
      .exec();

    return {
      bookingType,
      bookingId,
      policyVersion: acceptance?.policyVersion ?? 'v1',
      acceptedAt: acceptance?.acceptedAt ?? null,
      accepted: Boolean(acceptance),
    };
  }

  async acceptPolicies(
    bookingType: 'flight' | 'hotel',
    bookingId: string,
    userId: string,
    policyVersion = 'v1',
  ) {
    const now = new Date();
    const acceptance = await this.model
      .findOneAndUpdate(
        { bookingType, bookingId, userId: new Types.ObjectId(userId) },
        { $set: { policyVersion, acceptedAt: now } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    return {
      bookingType,
      bookingId,
      userId,
      policyVersion: acceptance.policyVersion,
      acceptedAt: acceptance.acceptedAt,
    };
  }
}
