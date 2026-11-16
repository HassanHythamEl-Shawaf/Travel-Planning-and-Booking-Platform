import type { ImageExtension } from './uploads.constants';

/**
 * A multipart file as parsed by multer with memory storage (the default of
 * FileInterceptor). Same shape as Blog's UploadedImageFile.
 */
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** The first bytes ("magic bytes") every JPEG and PNG file starts with. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  return (
    buffer.length >= signature.length &&
    signature.every((byte, i) => buffer[i] === byte)
  );
}

/**
 * Detects the real image type from the file content. The client's file name
 * and mimetype are never trusted, because they are easy to fake.
 */
export function detectImageType(buffer: Buffer): ImageExtension | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) return 'jpg';
  if (startsWith(buffer, PNG_SIGNATURE)) return 'png';
  return null;
}

/** True if the value looks like a multer file (has a Buffer). */
export function isUploadedFile(value: unknown): value is UploadedImageFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    Buffer.isBuffer((value as { buffer?: unknown }).buffer)
  );
}
