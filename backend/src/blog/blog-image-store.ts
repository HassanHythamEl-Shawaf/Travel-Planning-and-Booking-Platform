/**
 * Seam to the shared upload module (GEN-08, Person 8). Blog never stores
 * files itself: it calls whatever is bound to BLOG_IMAGE_STORE. Until the
 * upload module binds it (in BlogModule), the image endpoints answer 501.
 *
 * The store owns type/size validation (JPG/PNG, 5 MB) and throws a 400
 * HttpException for a rejected file; Blog only enforces the 5-per-post limit.
 */
export const BLOG_IMAGE_STORE = Symbol('BLOG_IMAGE_STORE');

/** The multipart file as parsed by multer (memory storage). */
export interface UploadedImageFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface StoredImage {
  imageId: string;
  url: string;
}

export interface BlogImageStore {
  upload(
    file: UploadedImageFile,
    owner: { type: 'post'; id: string },
  ): Promise<StoredImage>;
  delete(imageId: string): Promise<void>;
}
