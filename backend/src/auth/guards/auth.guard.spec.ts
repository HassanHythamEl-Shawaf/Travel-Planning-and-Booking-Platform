import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import {
  AccountStatus,
  UserDocument,
  UserRole,
} from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../decorators/allow-password-change.decorator';
import { AuthenticatedUser } from '../decorators/current-user.decorator';
import { AuthGuard } from './auth.guard';

describe('AuthGuard', () => {
  const handler = () => undefined;
  const controllerClass = class TestController {};
  const request: {
    cookies: { access_token: string };
    user?: AuthenticatedUser;
  } = { cookies: { access_token: 'access-token' } };
  const user = {
    _id: { toString: () => 'user-id' },
    role: UserRole.USER,
    status: AccountStatus.ACTIVE,
    lastActivityAt: new Date(),
    refreshTokenHash: 'stored-refresh-token-hash',
    mustChangePassword: false,
  };

  let guard: AuthGuard;
  let reflector: Reflector;
  let usersService: jest.Mocked<
    Pick<UsersService, 'findByIdForAuth' | 'updateLastActivity'>
  >;

  const context = (routeHandler = handler): ExecutionContext =>
    ({
      getHandler: () => routeHandler,
      getClass: () => controllerClass,
      getArgs: () => [request, {}, () => undefined],
      getArgByIndex: () => undefined,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
      getType: () => 'http',
    }) as ExecutionContext;

  beforeEach(() => {
    Reflect.deleteMetadata(ALLOW_PASSWORD_CHANGE_KEY, handler);
    delete request.user;
    reflector = new Reflector();
    usersService = {
      findByIdForAuth: jest.fn().mockResolvedValue({ ...user } as UserDocument),
      updateLastActivity: jest.fn().mockResolvedValue(undefined),
    };

    guard = new AuthGuard(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: 'user-id',
          role: UserRole.USER,
        }),
      } as JwtService,
      {
        getOrThrow: jest.fn().mockReturnValue('access-secret'),
      } as ConfigService,
      usersService as UsersService,
      reflector,
    );
  });

  it('updates activity for an active session', async () => {
    await expect(guard.canActivate(context())).resolves.toBe(true);
    expect(usersService.updateLastActivity).toHaveBeenCalledWith('user-id');
    expect(request).toHaveProperty('user', {
      sub: 'user-id',
      role: UserRole.USER,
    });
  });

  it('rejects access after the refresh token has been revoked', async () => {
    usersService.findByIdForAuth.mockResolvedValue({
      ...user,
      refreshTokenHash: null,
    } as UserDocument);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.updateLastActivity).not.toHaveBeenCalled();
  });

  it('requires temporary-password users to change their password first', async () => {
    usersService.findByIdForAuth.mockResolvedValue({
      ...user,
      mustChangePassword: true,
    } as UserDocument);

    await expect(guard.canActivate(context())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows the marked password-change route for temporary-password users', async () => {
    usersService.findByIdForAuth.mockResolvedValue({
      ...user,
      mustChangePassword: true,
    } as UserDocument);
    Reflect.defineMetadata(ALLOW_PASSWORD_CHANGE_KEY, true, handler);

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
});
