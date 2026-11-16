import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { detectImageType, isUploadedFile } from './image-file';
import { Upload } from './schemas/upload.schema';
import {
  DEFAULT_UPLOAD_DIR,
  IMAGE_TYPES,
  type ImageExtension,
  MAX_IMAGE_BYTES,
  STORED_FILE_NAME_PATTERN,
  UPLOAD_ERRORS,
  UPLOADS_URL_PREFIX,
  type UploadOwnerType,
} from './uploads.constants';

/** What an image belongs to, e.g. { type: 'post', id: '<postId>' }. */
export interface UploadOwner {
  type: UploadOwnerType;
  id: string;
}

/** What the upload module returns for a stored image. */
export interface StoredUpload {
  /** Id of the upload record; use it to delete the image. */
  id: string;
  /** Public URL, e.g. /api/uploads/<uuid>.jpg */
  url: string;
  fileName: string;
  mimeType: string;
  /** Size in bytes. */
  size: number;
}

/**
 * The shared image upload module (GEN-08). Validates JPG/PNG and 5 MB,
 * stores the file under UPLOAD_DIR with a random name, records it in the
 * `uploads` collection, and deletes it again.
 *
 * Per-item limits (5 per post, activity or hotel, 1 logo per airline) are
 * enforced by the owning module with a conditional update (spec D3).
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly uploadDir: string;

  constructor(
    @InjectModel(Upload.name) private readonly uploads: Model<Upload>,
    config: ConfigService,
  ) {
    this.uploadDir = resolve(
      config.get<string>('UPLOAD_DIR') || DEFAULT_UPLOAD_DIR,
    );
  }

  /**
   * Checks a file and returns its real type. Throws 400 if it is missing,
   * empty, larger than 5 MB, or not really a JPG or PNG.
   */
  validate(file: unknown): ImageExtension {
    if (!isUploadedFile(file)) {
      throw new BadRequestException(UPLOAD_ERRORS.missing);
    }
    const size = file.buffer.length;
    if (size === 0) throw new BadRequestException(UPLOAD_ERRORS.empty);
    if (size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(UPLOAD_ERRORS.tooLarge);
    }
    const type = detectImageType(file.buffer);
    if (!type) throw new BadRequestException(UPLOAD_ERRORS.wrongType);
    return type;
  }

  /** Validates and stores an image for an item. */
  async upload(
    file: unknown,
    owner: UploadOwner,
    uploaderId?: string,
  ): Promise<StoredUpload> {
    const type = this.validate(file);
    const { buffer } = file as { buffer: Buffer };
    return this.store(buffer, type, owner, uploaderId ?? null);
  }

  /**
   * Makes an independent copy of a stored image for another item (used when
   * an itinerary is cloned, so deleting the original never breaks the copy).
   * Returns null if the original no longer exists.
   */
  async copy(
    uploadId: string,
    owner: UploadOwner,
    uploaderId?: string,
  ): Promise<StoredUpload | null> {
    if (!Types.ObjectId.isValid(uploadId)) return null;
    const original = await this.uploads.findById(uploadId).lean().exec();
    if (!original) return null;

    let buffer: Buffer;
    try {
      buffer = await readFile(this.pathOf(original.fileName));
    } catch {
      return null;
    }
    const type = detectImageType(buffer);
    if (!type) return null;
    return this.store(buffer, type, owner, uploaderId ?? null);
  }

  /** Deletes an image by its upload id. Does nothing if it does not exist. */
  async delete(uploadId: string): Promise<void> {
    if (!Types.ObjectId.isValid(uploadId)) return;
    const record = await this.uploads.findByIdAndDelete(uploadId).lean().exec();
    if (record) await this.removeFile(record.fileName);
  }

  /** Deletes an image by its URL. Does nothing if it is not one of ours. */
  async deleteByUrl(url: string): Promise<void> {
    const fileName = this.fileNameFromUrl(url);
    if (!fileName) return;
    const record = await this.uploads
      .findOneAndDelete({ fileName })
      .lean()
      .exec();
    if (record) await this.removeFile(record.fileName);
  }

  /** Number of stored images for an item. */
  countFor(owner: UploadOwner): Promise<number> {
    return this.uploads
      .countDocuments({ ownerType: owner.type, ownerId: owner.id })
      .exec();
  }

  /**
   * Finds a stored file for serving. Returns null for names that do not
   * match the stored-name pattern, unknown names and missing files.
   */
  async findFile(
    fileName: string,
  ): Promise<{ path: string; mimeType: string } | null> {
    if (!STORED_FILE_NAME_PATTERN.test(fileName)) return null;
    const record = await this.uploads.findOne({ fileName }).lean().exec();
    if (!record) return null;
    const path = this.pathOf(fileName);
    try {
      await access(path);
    } catch {
      return null;
    }
    return { path, mimeType: record.mimeType };
  }

  /** Writes the file, then the record. If the record fails, removes the file. */
  private async store(
    buffer: Buffer,
    type: ImageExtension,
    owner: UploadOwner,
    uploaderId: string | null,
  ): Promise<StoredUpload> {
    await mkdir(this.uploadDir, { recursive: true });
    const fileName = `${randomUUID()}.${type}`;
    // 'wx' fails instead of overwriting if the name already exists.
    await writeFile(this.pathOf(fileName), buffer, { flag: 'wx' });

    try {
      const record = await this.uploads.create({
        ownerType: owner.type,
        ownerId: owner.id,
        uploaderId,
        fileName,
        mimeType: IMAGE_TYPES[type],
        size: buffer.length,
        url: `${UPLOADS_URL_PREFIX}/${fileName}`,
      });
      return {
        id: record._id.toString(),
        url: record.url,
        fileName: record.fileName,
        mimeType: record.mimeType,
        size: record.size,
      };
    } catch (error) {
      await this.removeFile(fileName);
      throw error;
    }
  }

  /** Best effort: a file that is already gone is fine; other errors are logged. */
  private async removeFile(fileName: string): Promise<void> {
    try {
      await unlink(this.pathOf(fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Could not delete file ${fileName}`);
      }
    }
  }

  /** Only ever called with names that match STORED_FILE_NAME_PATTERN. */
  private pathOf(fileName: string): string {
    if (!STORED_FILE_NAME_PATTERN.test(fileName)) {
      throw new Error('Invalid stored file name');
    }
    return join(this.uploadDir, fileName);
  }

  private fileNameFromUrl(url: string): string | null {
    if (typeof url !== 'string') return null;
    const fileName = url.split('/').pop() ?? '';
    return url === `${UPLOADS_URL_PREFIX}/${fileName}` &&
      STORED_FILE_NAME_PATTERN.test(fileName)
      ? fileName
      : null;
  }
}
