import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import {
  AccountStatus,
  UserDocument,
  UserRole,
} from '../users/schemas/user.schema';
import { AuthService } from './auth.service';

describe('AuthService login protection', () => {
  let service: AuthService;
  let user: UserDocument;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByEmailForAuth' | 'recordFailedLogin'>
  >;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('CorrectPassword123', 4);
  });

  beforeEach(() => {
    user = {
      _id: { toString: () => 'user-id' },
      email: 'user@example.com',
      passwordHash,
      lockUntil: null,
      failedLoginAttempts: 0,
      status: AccountStatus.ACTIVE,
      role: UserRole.USER,
      name: 'Test User',
      mustChangePassword: false,
      refreshTokenHash: null,
      lastActivityAt: null,
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as UserDocument;
    usersService = {
      findByEmailForAuth: jest.fn().mockResolvedValue(user),
      recordFailedLogin: jest.fn(),
    };

    service = new AuthService(
      usersService as UsersService,
      {
        signAsync: jest
          .fn()
          .mockResolvedValueOnce('access-token')
          .mockResolvedValueOnce('refresh-token'),
      } as unknown as JwtService,
      {
        getOrThrow: jest.fn((key: string) => key),
      } as unknown as ConfigService,
    );
  });

  it('records each failed attempt atomically and locks on the fifth', async () => {
    let attempts = 0;
    usersService.recordFailedLogin.mockImplementation(async () => {
      attempts += 1;
      return {
        failedLoginAttempts: attempts,
        lockUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
      };
    });

    for (let attempt = 1; attempt < 5; attempt += 1) {
      await expect(
        service.login({
          email: user.email,
          password: 'WrongPassword123',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }

    await expect(
      service.login({
        email: user.email,
        password: 'WrongPassword123',
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(usersService.recordFailedLogin).toHaveBeenCalledTimes(5);
  });

  it('rejects attempts while the account is already locked', async () => {
    user.lockUntil = new Date(Date.now() + 60_000);

    await expect(
      service.login({
        email: user.email,
        password: 'WrongPassword123',
      }),
    ).rejects.toMatchObject({ status: 429 });

    expect(usersService.recordFailedLogin).not.toHaveBeenCalled();
  });

  it('resets the failed-attempt counter after a successful login', async () => {
    user.failedLoginAttempts = 4;
    usersService.recordFailedLogin.mockResolvedValue({
      failedLoginAttempts: 0,
      lockUntil: null,
    });

    const result = await service.login({
      email: user.email,
      password: 'CorrectPassword123',
    });

    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lastActivityAt).toBeInstanceOf(Date);
    expect(user.save).toHaveBeenCalled();
  });
});
