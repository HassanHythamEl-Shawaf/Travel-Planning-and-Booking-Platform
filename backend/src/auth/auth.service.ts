import {
  ConflictException,
  Injectable,
} from '@nestjs/common';

import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import {
  UserRole,
  AccountStatus,
} from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  async register(registerDto: RegisterDto) {
    const normalizedEmail = registerDto.email.trim().toLowerCase();

    // Check whether the email is already registered
    const existingUser =
      await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    // Hash the password before storing it
    const passwordHash = await bcrypt.hash(
      registerDto.password,
      12,
    );

    try {
      // Create the user
      const user = await this.usersService.create({
        name: registerDto.name.trim(),
        email: normalizedEmail,
        passwordHash,
        role: UserRole.USER,
        status: AccountStatus.ACTIVE,
        termsAcceptedAt: new Date(),
        privacyPolicyAcceptedAt: new Date(),
        failedLoginAttempts: 0,
        lockUntil: null,
        refreshTokenHash: null,
        lastActivityAt: null,
        mustChangePassword: false,
      });

      // Return only safe public information
      return {
        message: 'Registration successful',
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
        },
      };
    } catch (error: unknown) {
      // Handle duplicate email errors from MongoDB
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'Email is already registered',
        );
      }

      throw error;
    }
  }
}