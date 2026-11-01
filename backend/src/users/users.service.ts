import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  User,
  UserDocument,
  AccountStatus,
} from './schemas/user.schema';

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
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .exec();
  }

  // Find a user by email, including sensitive authentication fields
  async findByEmailForAuth(
    email: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('+passwordHash +refreshTokenHash')
      .exec();
  }

  // Find a user by MongoDB ID
  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
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