import { createReadStream } from 'node:fs';

import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';

import { UploadsService } from './uploads.service';

/**
 * Serves stored images by URL (GEN-08). Lives in the uploads module, not in
 * main.ts, so it also exists in the e2e tests, which build the app from
 * AppModule.
 */
@ApiTags('Uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get(':fileName')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'public, max-age=86400')
  @ApiOperation({
    summary: 'Download a stored image (GEN-08)',
    description:
      'Public. Image URLs returned by the upload endpoints (blog posts, activities, hotels, airlines) point here: /api/uploads/<uuid>.jpg or .png. Images are uploaded through those modules, not here.',
  })
  @ApiParam({
    name: 'fileName',
    example: '3f1c2a9e-8b4d-4c1e-9f2a-7d6e5b4a3c21.jpg',
  })
  @ApiProduces('image/jpeg', 'image/png')
  @ApiOkResponse({
    description: 'The image file',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'No image with this name' })
  async serve(@Param('fileName') fileName: string): Promise<StreamableFile> {
    const file = await this.uploads.findFile(fileName);
    if (!file) throw new NotFoundException('Image not found');
    return new StreamableFile(createReadStream(file.path), {
      type: file.mimeType,
    });
  }
}
