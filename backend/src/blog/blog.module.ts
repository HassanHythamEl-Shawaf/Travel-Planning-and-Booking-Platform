import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { ModerationModule } from '../moderation/moderation.module';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { UsersModule } from '../users/users.module';
import { AuthorsController } from './authors.controller';
import { AuthorsService } from './authors.service';
import { BlogCascadeService } from './blog-cascade.service';
import { BlogImageCleaner } from './blog-image-cleaner';
import { BLOG_IMAGE_STORE } from './blog-image-store';
import { BlogModerationHandlers } from './blog-moderation.handlers';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';
import { OptionalAuthGuard } from './optional-auth.guard';
import { PostImagesController } from './post-images.controller';
import { PostImagesService } from './post-images.service';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { Comment, CommentSchema } from './schemas/comment.schema';
import { Like, LikeSchema } from './schemas/like.schema';
import { Post, PostSchema } from './schemas/post.schema';
import { PublicItineraryReader } from './public-itinerary.reader';
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
    ModerationModule,
  ],
  controllers: [
    PostsController,
    TagsController,
    CommentsController,
    LikesController,
    PostImagesController,
    AuthorsController,
  ],
  providers: [
    PostsService,
    CommentsService,
    LikesService,
    PostImagesService,
    AuthorsService,
    BlogCascadeService,
    BlogImageCleaner,
    BlogModerationHandlers,
    PublicItineraryReader,
    OptionalAuthGuard,
    // Bound to the shared upload module (GEN-08) once it is on develop,
    // e.g. { provide: BLOG_IMAGE_STORE, useExisting: <its service adapter> }.
    // While null, the image endpoints answer 501.
    { provide: BLOG_IMAGE_STORE, useValue: null },
  ],
})
export class BlogModule {}
