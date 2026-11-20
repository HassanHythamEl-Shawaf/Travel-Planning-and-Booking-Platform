import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { AdminModerationController } from './admin-moderation.controller';
import { AdminReportsService } from './admin-reports.service';
import { ModerationService } from './moderation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { Report, ReportSchema } from './schemas/report.schema';

/** GEN-09 content reports and GEN-10 admin moderation. */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Report.name, schema: ReportSchema }]),
    AuthModule,
    UsersModule,
    // AuthGuard is instantiated in this module and needs JwtService.
    JwtModule.register({}),
    ModerationModule,
    AuditLogsModule,
    NotificationsModule,
  ],
  controllers: [ReportsController, AdminModerationController],
  providers: [ReportsService, AdminReportsService, ModerationService],
})
export class ReportsModule {}
