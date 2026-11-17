import { Injectable } from '@nestjs/common';

import type {
  BlogImageStore,
  StoredImage,
  UploadedImageFile,
} from '../../blog/blog-image-store';
import { UploadsService } from '../uploads.service';

/**
 * Blog's BLOG_IMAGE_STORE (BLG-10). Blog enforces 5 images per post itself
 * with a conditional push; this adapter validates and stores the file.
 */
@Injectable()
export class BlogImageUploadAdapter implements BlogImageStore {
  constructor(private readonly uploads: UploadsService) {}

  async upload(
    file: UploadedImageFile,
    owner: { type: 'post'; id: string },
  ): Promise<StoredImage> {
    const stored = await this.uploads.upload(file, {
      type: 'post',
      id: owner.id,
    });
    return { imageId: stored.id, url: stored.url };
  }

  delete(imageId: string): Promise<void> {
    return this.uploads.delete(imageId);
  }
}
