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
  ownerId?: unknown;
  title?: unknown;
  countries?: unknown;
  isPublic?: unknown;
  isHidden?: unknown;
  createdAt?: unknown;
}

/** BLG-13: an itinerary attached to a post, with what visibility needs. */
export interface AttachableItinerary extends PublicItinerarySummary {
  ownerId: string | null;
  isPublic: boolean;
  isHidden: boolean;
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

    return rows.map(toSummary);
  }

  /**
   * BLG-13 (bonus, Person 8): one itinerary by id, whatever its visibility;
   * the caller decides who may see it. null if it does not exist.
   */
  async findById(id: Types.ObjectId): Promise<AttachableItinerary | null> {
    const row = await this.connection
      .collection<ItineraryRow>(CONTENT_COLLECTIONS.itinerary)
      .findOne(
        { _id: id },
        {
          projection: {
            [F.ownerId]: 1,
            [F.title]: 1,
            [F.countries]: 1,
            [F.isPublic]: 1,
            [F.isHidden]: 1,
            [F.createdAt]: 1,
          },
        },
      );
    if (!row) return null;
    return {
      ...toSummary(row),
      ownerId:
        row.ownerId instanceof Types.ObjectId ? row.ownerId.toString() : null,
      isPublic: row.isPublic === true,
      isHidden: row.isHidden === true,
    };
  }
}

function toSummary(row: ItineraryRow): PublicItinerarySummary {
  return {
    id: row._id.toString(),
    title: typeof row.title === 'string' ? row.title : '',
    countries: Array.isArray(row.countries)
      ? row.countries.filter((c): c is string => typeof c === 'string')
      : [],
    createdAt: row.createdAt instanceof Date ? row.createdAt : null,
  };
}
