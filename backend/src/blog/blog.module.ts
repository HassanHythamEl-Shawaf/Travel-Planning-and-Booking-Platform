import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { UsersModule } from '../users/users.module';
import { BlogCascadeService } from './blog-cascade.service';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { OptionalAuthGuard } from './optional-auth.guard';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { TagsController } from './tags.controller';

/** Blog (BLG-01 – BLG-12). */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Post.name, schema: PostSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Like.name, schema: LikeSchema },
      // Same model as ReportsModule; used to close reports on deleted content (D6).
      { name: Report.name, schema: ReportSchema },
    ]),
    AuthModule,
    UsersModule,
    // AuthGuard and OptionalAuthGuard are instantiated here and need JwtService.
    JwtModule.register({}),
  ],
  controllers: [
    PostsController,
    TagsController,
    CommentsController,
    LikesController,
  ],
  providers: [
    PostsService,
    CommentsService,
    LikesService,
    BlogCascadeService,
    OptionalAuthGuard,
  ],
})
export class BlogModule {}
