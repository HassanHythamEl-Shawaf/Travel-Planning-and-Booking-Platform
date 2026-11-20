import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
  mixin,
  type NestInterceptor,
  PayloadTooLargeException,
  type Type,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Observable } from 'rxjs';

import { MAX_IMAGE_BYTES, UPLOAD_ERRORS } from './uploads.constants';

/**
 * FileInterceptor for one image (GEN-08). Multer stops reading a file that
 * is over 5 MB, so a huge upload is never fully loaded into memory. Multer's
 * "file too large" error (413 in Nest) is turned into a clear 400, the same
 * status as every other rejected image.
 *
 * Usage: @UseInterceptors(ImageFileInterceptor('file'))
 */
export function ImageFileInterceptor(
  fieldName = 'file',
): Type<NestInterceptor> {
  const MulterInterceptor = FileInterceptor(fieldName, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  });

  class ImageInterceptor implements NestInterceptor {
    private readonly multer = new MulterInterceptor();

    async intercept(
      context: ExecutionContext,
      next: CallHandler,
    ): Promise<Observable<unknown>> {
      try {
        return await this.multer.intercept(context, next);
      } catch (error) {
        if (error instanceof PayloadTooLargeException) {
          throw new BadRequestException(UPLOAD_ERRORS.tooLarge);
        }
        throw error;
      }
    }
  }

  return mixin(ImageInterceptor);
}
