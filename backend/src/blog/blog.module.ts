import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { UsersModule } from '../users/users.module';
import { BlogCascadeService } from './blog-cascade.service';
import { OptionalAuthGuard } from './optional-auth.guard';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

/** Blog (BLG-01 – BLG-12). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      // Same model as ReportsModule; used to close reports on deleted content (D6).
      { name: Report.name, schema: ReportSchema },
    ]),
    AuthModule,
    UsersModule,
    // AuthGuard and OptionalAuthGuard are instantiated here and need JwtService.
    JwtModule.register({}),
  ],
  controllers: [PostsController, TagsController],
  providers: [PostsService, BlogCascadeService, OptionalAuthGuard],
})
export class BlogModule {}
