/**
 * GEN-08 limits, shared by every module that stores images
 * (blog posts, itinerary activities, hotels, airlines).
 */

/** 5 MB per image. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Allowed image types: file extension -> content type. */
export const IMAGE_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
} as const;

export type ImageExtension = keyof typeof IMAGE_TYPES;

/** What an uploaded image belongs to. */
export const UPLOAD_OWNER_TYPES = [
  'post',
  'activity',
  'hotel',
  'airline',
] as const;

export type UploadOwnerType = (typeof UPLOAD_OWNER_TYPES)[number];

/**
 * Maximum number of images per item (GEN-08). The owning module enforces it
 * with a conditional update on its own document, so parallel uploads can
 * never go over it (see docs/requirements/GEN-08-uploads-spec.md, D3).
 */
export const MAX_IMAGES_PER_ITEM: Record<UploadOwnerType, number> = {
  post: 5,
  activity: 5,
  hotel: 5,
  airline: 1,
};

/** Folder for stored files when UPLOAD_DIR is not set (relative to backend/). */
export const DEFAULT_UPLOAD_DIR = 'uploads';

/** Stored files are served at `${UPLOADS_URL_PREFIX}/<fileName>`. */
export const UPLOADS_URL_PREFIX = '/api/uploads';

/** Stored file names: a random UUID plus the real extension. */
export const STORED_FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/;

export const UPLOAD_ERRORS = {
  missing: 'An image file is required',
  empty: 'The image file is empty',
  tooLarge: 'Images can be at most 5 MB',
  wrongType: 'Only JPG or PNG images are allowed',
} as const;
