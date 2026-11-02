import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { AccountStatus } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const token = request.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: AuthenticatedUser;
    try {
      payload = await this.jwtService.verifyAsync<AuthenticatedUser>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user || user.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException('Invalid session');
    }

    const now = new Date();
    const lastActivityAt = user.lastActivityAt?.getTime();

    if (
      lastActivityAt === undefined ||
      now.getTime() - lastActivityAt > 30 * 60 * 1000
    ) {
      throw new UnauthorizedException('Session expired due to inactivity');
    }

    await this.usersService.updateLastActivity(user._id.toString());

    request.user = {
      sub: user._id.toString(),
      role: user.role,
    };
    return true;
  }
}
