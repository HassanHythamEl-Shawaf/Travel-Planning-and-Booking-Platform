import { Injectable } from '@nestjs/common';

import { UploadsService } from '../uploads.service';

/** Token for hotel photo storage (HTL-01, GEN-08). */
export const HOTEL_PHOTO_STORE = Symbol('HOTEL_PHOTO_STORE');

/**
 * Hotels keep photos as URL strings (`photos: string[]`). The hotel service
 * enforces 5 photos per hotel with a conditional push
 * (`'photos.4': { $exists: false }`), like Blog does for posts.
 */
export interface HotelPhotoStore {
  /** Validates and stores the photo; returns its URL. */
  upload(file: unknown, hotelId: string): Promise<string>;
  /** Deletes the stored file behind a photo URL. */
  remove(photoUrl: string): Promise<void>;
}

@Injectable()
export class HotelPhotoUploadAdapter implements HotelPhotoStore {
  constructor(private readonly uploads: UploadsService) {}

  async upload(file: unknown, hotelId: string): Promise<string> {
    const stored = await this.uploads.upload(file, {
      type: 'hotel',
      id: hotelId,
    });
    return stored.url;
  }

  remove(photoUrl: string): Promise<void> {
    return this.uploads.deleteByUrl(photoUrl);
  }
}
