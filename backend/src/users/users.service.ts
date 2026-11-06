import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { User, UserDocument, AccountStatus } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  // Create a new user
  async create(userData: Partial<User>): Promise<UserDocument> {
    return this.userModel.create(userData);
  }

  // Find a user by email (normal queries)
  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  // Find a user by email, including sensitive authentication fields
  async findByEmailForAuth(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash +refreshTokenHash')
      .exec();
  }

  // Find a user by MongoDB ID
  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByIdForAuth(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findById(id)
      .select('+passwordHash +refreshTokenHash')
      .exec();
  }

  async updateLastActivity(id: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: id },
      { $set: { lastActivityAt: new Date() } },
    );
  }

  async recordFailedLogin(
    email: string,
    now: Date,
  ): Promise<Pick<User, 'failedLoginAttempts' | 'lockUntil'> | null> {
    return this.userModel
      .findOneAndUpdate(
        {
          email: email.toLowerCase().trim(),
          status: AccountStatus.ACTIVE,
          $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
        },
        [
          {
            $set: {
              failedLoginAttempts: {
                $add: [
                  {
                    $cond: [
                      {
                        $and: [
                          { $ne: ['$lockUntil', null] },
                          { $lte: ['$lockUntil', now] },
                        ],
                      },
                      0,
                      { $ifNull: ['$failedLoginAttempts', 0] },
                    ],
                  },
                  1,
                ],
              },
            },
          },
          {
            $set: {
              lockUntil: {
                $cond: [
                  { $gte: ['$failedLoginAttempts', 5] },
                  {
                    $dateAdd: {
                      startDate: '$$NOW',
                      unit: 'minute',
                      amount: 15,
                    },
                  },
                  null,
                ],
              },
            },
          },
        ],
        {
          new: true,
          updatePipeline: true,
          projection: {
            failedLoginAttempts: 1,
            lockUntil: 1,
          },
        },
      )
      .lean()
      .exec();
  }

  async changePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne(
      { _id: id },
      {
        $set: {
          passwordHash,
          mustChangePassword: false,
          refreshTokenHash: null,
          failedLoginAttempts: 0,
          lockUntil: null,
        },
      },
    );
  }

  async deactivateAccount(id: string): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: AccountStatus.DEACTIVATED,
            refreshTokenHash: null,
          },
        },
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();
  }

  // Update editable profile information
  async updateProfile(
    id: string,
    updates: Partial<Pick<User, 'name' | 'phone' | 'preferredCurrency'>>,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(id, updates, {
        new: true,
        runValidators: true,
      })
      .exec();
  }

  // Change account status
  async updateStatus(
    id: string,
    status: AccountStatus,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        id,
        { status },
        {
          new: true,
          runValidators: true,
        },
      )
      .exec();
  }
}
