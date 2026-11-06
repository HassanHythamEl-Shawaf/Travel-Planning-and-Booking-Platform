import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BLOG_IMAGE_STORE, type BlogImageStore } from './blog-image-store';

/**
 * Removes stored image files after the database change is committed (D6).
 * Best effort: a failure is logged and never fails the request. Does
 * nothing while no upload module is bound.
 */
@Injectable()
export class BlogImageCleaner {
  private readonly logger = new Logger(BlogImageCleaner.name);

  constructor(
    @Optional()
    @Inject(BLOG_IMAGE_STORE)
    private readonly store?: BlogImageStore | null,
  ) {}

  async deleteFiles(imageIds: string[]): Promise<void> {
    if (!this.store) return;
    for (const imageId of imageIds) {
      try {
        await this.store.delete(imageId);
      } catch (error) {
        this.logger.warn(
          `Could not delete image ${imageId}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }
}
