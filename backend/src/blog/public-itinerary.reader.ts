import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import {
  CONTENT_COLLECTIONS,
  ITINERARY_FIELDS as F,
} from '../integrations/teammate-contracts';

export interface PublicItinerarySummary {
  id: string;
  title: string;
  countries: string[];
  createdAt: Date | null;
}

interface ItineraryRow {
  _id: Types.ObjectId;
  title?: unknown;
  countries?: unknown;
  createdAt?: unknown;
}

/**
 * Read-only adapter over Hammad's `itineraries` collection for author pages
 * (BLG-12). Field names live in teammate-contracts.ts; a missing collection
 * simply yields [].
 */
@Injectable()
export class PublicItineraryReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listPublicByOwner(
    ownerId: Types.ObjectId,
    limit: number,
  ): Promise<PublicItinerarySummary[]> {
    const rows = await this.connection
      .collection<ItineraryRow>(CONTENT_COLLECTIONS.itinerary)
      .find(
        {
          [F.ownerId]: ownerId,
          [F.isPublic]: true,
          [F.isHidden]: { $ne: true },
        },
        {
          projection: { [F.title]: 1, [F.countries]: 1, [F.createdAt]: 1 },
          sort: { [F.createdAt]: -1, _id: -1 },
          limit,
        },
      )
      .toArray();

    return rows.map((row) => ({
      id: row._id.toString(),
      title: typeof row.title === 'string' ? row.title : '',
      countries: Array.isArray(row.countries)
        ? row.countries.filter((c): c is string => typeof c === 'string')
        : [],
      createdAt: row.createdAt instanceof Date ? row.createdAt : null,
    }));
  }
}
