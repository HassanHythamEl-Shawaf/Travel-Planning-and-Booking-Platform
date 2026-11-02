import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private get accessSecret(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_SECRET');
  }

  private get refreshSecret(): string {
    return this.configService.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  private async issueTokens(user: {
    _id: { toString(): string };
    role: UserRole;
  }) {
    const payload = {
      sub: user._id.toString(),
      role: user.role,
    };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: '30m',
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.refreshSecret,
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  async register(registerDto: RegisterDto) {
    const normalizedEmail = registerDto.email.trim().toLowerCase();

    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await bcrypt.hash(registerDto.password, 12);

    try {
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
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  async login(loginDto: LoginDto) {
    const user = await this.usersService.findByEmailForAuth(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const now = new Date();

    if (user.lockUntil && user.lockUntil > now) {
      throw new HttpException(
        'Too many failed login attempts. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (user.lockUntil && user.lockUntil <= now) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
    }

    if (user.status === AccountStatus.SUSPENDED) {
      throw new ForbiddenException('Your account is suspended');
    }

    if (user.status === AccountStatus.DEACTIVATED) {
      throw new ForbiddenException('Your account is deactivated');
    }

    const passwordMatches = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      user.failedLoginAttempts += 1;

      if (user.failedLoginAttempts >= 5) {
        user.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        throw new HttpException(
          'Too many failed login attempts. Your account is locked for 15 minutes.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      await user.save();

      throw new UnauthorizedException('Invalid email or password');
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    user.lastActivityAt = now;

    const tokens = await this.issueTokens(user);
    user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
    await user.save();

    return {
      ...tokens,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    let payload: { sub: string; role: UserRole };

    try {
      payload = await this.jwtService.verifyAsync<{
        sub: string;
        role: UserRole;
      }>(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findByIdForAuth(payload.sub);

    if (
      !user ||
      user.status !== AccountStatus.ACTIVE ||
      !user.refreshTokenHash
    ) {
      throw new UnauthorizedException('Invalid session');
    }

    if (
      !user.lastActivityAt ||
      Date.now() - user.lastActivityAt.getTime() > 30 * 60 * 1000
    ) {
      user.refreshTokenHash = null;
      await user.save();
      throw new UnauthorizedException('Session expired due to inactivity');
    }

    const matches = await bcrypt.compare(refreshToken, user.refreshTokenHash);

    if (!matches) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    user.lastActivityAt = new Date();
    const tokens = await this.issueTokens(user);
    user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 12);
    await user.save();

    return {
      ...tokens,
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async logout(userId: string) {
    const user = await this.usersService.findByIdForAuth(userId);

    if (user) {
      user.refreshTokenHash = null;
      await user.save();
    }

    return { message: 'Logout successful' };
  }

  async getMe(userId: string) {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      phone: user.phone,
      preferredCurrency: user.preferredCurrency,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersService.findByIdForAuth(userId);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const matches = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );

    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new ForbiddenException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.usersService.changePasswordHash(userId, passwordHash);

    return {
      message: 'Password changed successfully. Please log in again.',
    };
  }
}
