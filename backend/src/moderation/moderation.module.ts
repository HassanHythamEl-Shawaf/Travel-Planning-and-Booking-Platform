import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ModerationRegistry } from './moderation.registry';

/**
 * GEN-09 / GEN-10. Content owners import this module and register their
 * handler with ModerationRegistry in onModuleInit.
 */
@Module({
  imports: [UsersModule],
  providers: [ModerationRegistry],
  exports: [ModerationRegistry],
})
export class ModerationModule {}
