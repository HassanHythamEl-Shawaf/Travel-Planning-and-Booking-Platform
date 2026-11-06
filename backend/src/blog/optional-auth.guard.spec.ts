import type { ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';

import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { OptionalAuthGuard } from './optional-auth.guard';

describe('OptionalAuthGuard (D17)', () => {
  const userId = new Types.ObjectId();
  let request: { cookies?: Record<string, string>; user?: unknown };
  let jwt: { verifyAsync: jest.Mock };
  let users: { findByIdForAuth: jest.Mock; updateLastActivity: jest.Mock };
  let guard: OptionalAuthGuard;

  const context = () =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  const storedUser = (extra: Record<string, unknown> = {}) => ({
    _id: userId,
    role: UserRole.USER,
    status: AccountStatus.ACTIVE,
    refreshTokenHash: 'hash',
    mustChangePassword: false,
    lastActivityAt: new Date(),
    ...extra,
  });

  beforeEach(() => {
    request = { cookies: { access_token: 'token' } };
    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({ sub: userId.toString() }),
    };
    users = {
      findByIdForAuth: jest.fn().mockResolvedValue(storedUser()),
      updateLastActivity: jest.fn().mockResolvedValue(undefined),
    };
    guard = new OptionalAuthGuard(
      jwt as never,
      { getOrThrow: () => 'secret' } as never,
      users as never,
    );
  });

  it('attaches the user for a valid session and refreshes activity', async () => {
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.user).toEqual({
      sub: userId.toString(),
      role: UserRole.USER,
    });
    expect(users.updateLastActivity).toHaveBeenCalledWith(userId.toString());
  });

  const guestCases: Array<[string, () => void]> = [
    ['no cookie', () => (request = {})],
    [
      'a bad token',
      () => jwt.verifyAsync.mockRejectedValue(new Error('invalid signature')),
    ],
    ['a token without sub', () => jwt.verifyAsync.mockResolvedValue({})],
    ['an unknown user', () => users.findByIdForAuth.mockResolvedValue(null)],
    [
      'an expired (idle) session',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ lastActivityAt: new Date(Date.now() - 31 * 60_000) }),
        ),
    ],
    [
      'a session never active',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ lastActivityAt: null }),
        ),
    ],
    [
      'a suspended account',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ status: AccountStatus.SUSPENDED }),
        ),
    ],
    [
      'a deactivated account',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ status: AccountStatus.DEACTIVATED }),
        ),
    ],
    [
      'a logged-out account',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ refreshTokenHash: null }),
        ),
    ],
    [
      'a forced password change',
      () =>
        users.findByIdForAuth.mockResolvedValue(
          storedUser({ mustChangePassword: true }),
        ),
    ],
    [
      'a database error',
      () => users.findByIdForAuth.mockRejectedValue(new Error('down')),
    ],
  ];

  it.each(guestCases)('lets %s through as a guest', async (_label, setup) => {
    setup();
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(request.user).toBeUndefined();
    expect(users.updateLastActivity).not.toHaveBeenCalled();
  });

  it('ignores a user set by an earlier middleware', async () => {
    request = { user: { sub: 'spoofed', role: UserRole.ADMIN } };
    await guard.canActivate(context());
    expect(request.user).toBeUndefined();
  });
});
