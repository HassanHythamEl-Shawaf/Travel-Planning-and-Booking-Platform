import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PROVIDER_ASSIGNMENT_READER } from '../auth/provider-assignment.reader';
import { IntegrationsModule } from '../integrations/integrations.module';
import { MongoModeratorAssignmentReader } from './moderator-assignment.reader';
import { ModeratorAssignmentsService } from './moderator-assignments.service';
import {
  ModeratorAssignment,
  ModeratorAssignmentSchema,
} from './schemas/moderator-assignment.schema';

/**
 * Standalone so AuthModule (for ProviderOwnershipGuard) and AdminModule can
 * both import it without a circular dependency. Must NOT import AuthModule,
 * hence no controllers here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
    ]),
    IntegrationsModule,
  ],
  providers: [
    ModeratorAssignmentsService,
    {
      provide: PROVIDER_ASSIGNMENT_READER,
      useClass: MongoModeratorAssignmentReader,
    },
  ],
  exports: [ModeratorAssignmentsService, PROVIDER_ASSIGNMENT_READER],
})
export class ModeratorAssignmentsModule {}
