import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AirlineLogoUploadAdapter } from './adapters/airline-logo.adapter';
import { BlogImageUploadAdapter } from './adapters/blog-image.adapter';
import {
  HOTEL_PHOTO_STORE,
  HotelPhotoUploadAdapter,
} from './adapters/hotel-photo.adapter';
import { Upload, UploadSchema } from './schemas/upload.schema';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

/**
 * Shared image upload module (GEN-08). Other modules import it and bind
 * their store token to one of the adapters, e.g.
 * { provide: BLOG_IMAGE_STORE, useExisting: BlogImageUploadAdapter }.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Upload.name, schema: UploadSchema }]),
  ],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    BlogImageUploadAdapter,
    AirlineLogoUploadAdapter,
    HotelPhotoUploadAdapter,
    { provide: HOTEL_PHOTO_STORE, useExisting: HotelPhotoUploadAdapter },
  ],
  exports: [
    UploadsService,
    BlogImageUploadAdapter,
    AirlineLogoUploadAdapter,
    HotelPhotoUploadAdapter,
    HOTEL_PHOTO_STORE,
  ],
})
export class UploadsModule {}
