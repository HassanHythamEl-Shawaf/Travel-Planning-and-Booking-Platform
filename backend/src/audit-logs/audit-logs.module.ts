import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { UsersModule } from '../users/users.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';

/** GEN-07. Exports AuditLogsService for teammates' moderation actions. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    // UsersModule: the User model (actor names) and AuthGuard's UsersService.
    // JwtModule: AuthGuard is instantiated in this module and needs JwtService.
    UsersModule,
    JwtModule.register({}),
  ],
  controllers: [AuditLogsController],
  providers: [AuditLogsService],
  exports: [AuditLogsService],
})
export class AuditLogsModule {}
