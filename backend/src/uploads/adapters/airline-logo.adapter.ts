import { Injectable } from '@nestjs/common';

import type { AirlineLogoStore } from '../../airlines/airline-logo-store';
import { UploadsService } from '../uploads.service';

/**
 * Airlines' AIRLINE_LOGO_STORE (FLT-01). One logo per airline: the airline
 * document has a single logoUrl, so uploading a new logo replaces the old
 * one and the airline service removes the old file.
 */
@Injectable()
export class AirlineLogoUploadAdapter implements AirlineLogoStore {
  constructor(private readonly uploads: UploadsService) {}

  async upload(file: unknown, airlineId: string): Promise<string> {
    const stored = await this.uploads.upload(file, {
      type: 'airline',
      id: airlineId,
    });
    return stored.url;
  }

  remove(logoUrl: string, airlineId: string): Promise<void> {
    return this.uploads.deleteByUrl(logoUrl, { type: 'airline', id: airlineId });
  }
}
