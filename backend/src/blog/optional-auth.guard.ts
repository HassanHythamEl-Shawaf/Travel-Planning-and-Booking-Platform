import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { AccountStatus } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

interface OptionalAuthRequest extends Request {
  user?: AuthenticatedUser;
}

/** Same inactivity window as AuthGuard. */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/**
 * For public GETs (D17). Runs the same checks as AuthGuard (access_token
 * cookie, JWT signature, refresh token present, active account, no forced
 * password change, 30-minute inactivity) but never throws: on any failure
 * the request continues as a guest. On success `request.user` is set exactly
 * like AuthGuard sets it, and the session activity is refreshed.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OptionalAuthRequest>();
    request.user = undefined;
    try {
      const user = await this.authenticate(request);
      if (user) request.user = user;
    } catch {
      // Any failure means "guest" (never 401 on a public GET).
    }
    return true;
  }

  private async authenticate(
    request: OptionalAuthRequest,
  ): Promise<AuthenticatedUser | null> {
    const token: unknown = request.cookies?.access_token;
    if (typeof token !== 'string' || token.length === 0) return null;

    const payload = await this.jwtService.verifyAsync<AuthenticatedUser>(
      token,
      { secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET') },
    );
    if (!payload.sub || typeof payload.sub !== 'string') return null;

    const user = await this.usersService.findByIdForAuth(payload.sub);
    if (
      !user ||
      user.status !== AccountStatus.ACTIVE ||
      !user.refreshTokenHash ||
      user.mustChangePassword
    ) {
      return null;
    }

    const lastActivityAt = user.lastActivityAt?.getTime();
    if (
      lastActivityAt === undefined ||
      Date.now() - lastActivityAt > SESSION_IDLE_MS
    ) {
      return null;
    }

    await this.usersService.updateLastActivity(user._id.toString());
    return { sub: user._id.toString(), role: user.role };
  }
}

/** The viewer set by OptionalAuthGuard, or undefined for a guest. */
export const OptionalCurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined =>
    context.switchToHttp().getRequest<OptionalAuthRequest>().user,
);
