import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { AuthController } from './auth.controller';

describe('AuthController route metadata', () => {
  it('exposes password changes as PATCH /auth/change-password', () => {
    const handler = AuthController.prototype.changePassword;

    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('change-password');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(
      RequestMethod.PATCH,
    );
  });
});
