import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { ModeratorAssignmentsModule } from '../moderator-assignments/moderator-assignments.module';
import { UsersModule } from '../users/users.module';
import { UsersController } from '../users/users.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './guards/auth.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { RolesGuard } from './guards/roles.guard';
import { ProviderOwnershipGuard } from './guards/provider-ownership.guard';

@Module({
  imports: [UsersModule, ModeratorAssignmentsModule, JwtModule.register({})],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    AuthGuard,
    CsrfGuard,
    RolesGuard,
    ProviderOwnershipGuard,
    { provide: APP_GUARD, useExisting: CsrfGuard },
  ],
  exports: [
    AuthService,
    AuthGuard,
    CsrfGuard,
    RolesGuard,
    ProviderOwnershipGuard,
  ],
})
export class AuthModule {}
