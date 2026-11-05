import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ModeratorAssignmentsModule } from '../moderator-assignments/moderator-assignments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ModeratorController } from './moderator.controller';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    // AuthGuard is instantiated in this module and needs JwtService.
    JwtModule.register({}),
    ModeratorAssignmentsModule,
    IntegrationsModule,
    AuditLogsModule,
    NotificationsModule,
  ],
  controllers: [AdminController, ModeratorController],
  providers: [AdminService],
})
export class AdminModule {}
