import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BlogImageCleaner } from './blog-image-cleaner';
import {
  BLOG_IMAGE_STORE,
  type BlogImageStore,
  type UploadedImageFile,
} from './blog-image-store';
import { POST_IMAGES_MAX } from './blog.constants';
import { PostImageDto } from './dto/post.dto';
import { type LeanPost, PostsService } from './posts.service';
import { Post } from './schemas/post.schema';

export const IMAGE_UPLOAD_UNAVAILABLE = 'Image upload not available yet';

/** BLG-10 / GEN-08 (D15). The first image is the cover. */
@Injectable()
export class PostImagesService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<Post>,
    private readonly posts: PostsService,
    private readonly cleaner: BlogImageCleaner,
    @Optional()
    @Inject(BLOG_IMAGE_STORE)
    private readonly store?: BlogImageStore | null,
  ) {}

  async add(
    postId: string,
    viewer: AuthenticatedUser,
    file: UploadedImageFile | undefined,
  ): Promise<{ images: PostImageDto[] }> {
    const store = this.requireStore();
    if (!file) throw new BadRequestException('An image file is required');
    const { post } = await this.posts.loadOwned(postId, viewer);
    if ((post.images ?? []).length >= POST_IMAGES_MAX) {
      throw new BadRequestException(
        `A post can have at most ${POST_IMAGES_MAX} images`,
      );
    }

    // Type and size are validated by the upload module (GEN-08).
    const image = await store.upload(file, { type: 'post', id: postId });

    // Conditional push: concurrent uploads can never exceed the limit.
    const updated = await this.postModel
      .findOneAndUpdate(
        {
          _id: post._id,
          authorId: post.authorId,
          [`images.${POST_IMAGES_MAX - 1}`]: { $exists: false },
        },
        { $push: { images: { imageId: image.imageId, url: image.url } } },
        { returnDocument: 'after' },
      )
      .lean<LeanPost>()
      .exec();
    if (!updated) {
      await this.cleaner.deleteFiles([image.imageId]);
      throw new BadRequestException(
        `A post can have at most ${POST_IMAGES_MAX} images`,
      );
    }
    return { images: this.toDto(updated) };
  }

  /** Removes the image from the post, then its file (best effort). */
  async remove(
    postId: string,
    imageId: string,
    viewer: AuthenticatedUser,
  ): Promise<{ images: PostImageDto[] }> {
    this.requireStore();
    const { post } = await this.posts.loadOwned(postId, viewer);

    const updated = await this.postModel
      .findOneAndUpdate(
        { _id: post._id, authorId: post.authorId, 'images.imageId': imageId },
        { $pull: { images: { imageId } } },
        { returnDocument: 'after' },
      )
      .lean<LeanPost>()
      .exec();
    if (!updated) throw new NotFoundException('Image not found on this post');

    await this.cleaner.deleteFiles([imageId]);
    return { images: this.toDto(updated) };
  }

  private requireStore(): BlogImageStore {
    if (!this.store) throw new NotImplementedException(IMAGE_UPLOAD_UNAVAILABLE);
    return this.store;
  }

  private toDto(post: LeanPost): PostImageDto[] {
    return (post.images ?? []).map((i) => ({ imageId: i.imageId, url: i.url }));
  }
}
