import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  const configService = new ConfigService({
    FRONTEND_URL: 'https://frontend.example.test',
  });
  let guard: CsrfGuard;

  const activate = (request: Partial<Request> & { get: jest.Mock }): boolean =>
    guard.canActivate({
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext);

  beforeEach(() => {
    guard = new CsrfGuard(configService);
  });

  it('allows requests from the configured frontend origin', () => {
    expect(
      activate({
        method: 'POST',
        headers: { origin: 'https://frontend.example.test' },
        protocol: 'https',
        get: jest.fn().mockReturnValue('api.example.test'),
      }),
    ).toBe(true);
  });

  it('allows requests from the API origin', () => {
    expect(
      activate({
        method: 'PATCH',
        headers: { origin: 'https://api.example.test' },
        protocol: 'https',
        get: jest.fn().mockReturnValue('api.example.test'),
      }),
    ).toBe(true);
  });

  it('rejects requests from a different origin', () => {
    expect(() =>
      activate({
        method: 'POST',
        headers: { origin: 'https://attacker.example.test' },
        protocol: 'https',
        get: jest.fn().mockReturnValue('api.example.test'),
      }),
    ).toThrow(ForbiddenException);
  });

  it('allows safe and origin-less non-browser requests', () => {
    expect(
      activate({
        method: 'GET',
        headers: { origin: 'https://attacker.example.test' },
        get: jest.fn().mockReturnValue('api.example.test'),
      }),
    ).toBe(true);
    expect(
      activate({
        method: 'POST',
        headers: {},
        get: jest.fn().mockReturnValue('api.example.test'),
      }),
    ).toBe(true);
  });
});
