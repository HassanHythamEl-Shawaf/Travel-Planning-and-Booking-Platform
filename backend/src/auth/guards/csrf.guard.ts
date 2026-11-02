import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly frontendOrigin: string;

  constructor(configService: ConfigService) {
    const frontendUrl =
      configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    this.frontendOrigin = new URL(frontendUrl).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const origin = request.headers.origin;
    const referer = request.headers.referer;
    const requestSource = origin ?? referer;

    if (!requestSource) {
      return true;
    }

    let requestOrigin: string | undefined;
    let sourceOrigin: string;

    try {
      if (request.get('host')) {
        requestOrigin = new URL(`${request.protocol}://${request.get('host')}`)
          .origin;
      }

      sourceOrigin = new URL(requestSource).origin;
    } catch {
      throw new ForbiddenException('Invalid request origin');
    }

    if (
      sourceOrigin !== this.frontendOrigin &&
      sourceOrigin !== requestOrigin
    ) {
      throw new ForbiddenException('Cross-origin request rejected');
    }

    return true;
  }
}
