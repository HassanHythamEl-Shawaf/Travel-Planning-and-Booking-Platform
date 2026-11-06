import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';

import type { ProviderType } from '../auth/decorators/provider-ownership.decorator';
import { PROVIDER_COLLECTIONS } from './teammate-contracts';

export const PROVIDER_DIRECTORY = Symbol('PROVIDER_DIRECTORY');

export interface ProviderSummary {
  id: string;
  type: ProviderType;
  name: string;
  isActive: boolean;
}

export interface ProviderDirectory {
  find(type: ProviderType, id: string): Promise<ProviderSummary | null>;
  /**
   * Conditional update: matches only if isActive !== active. Returns the new
   * summary, or null if not found / already in that state (caller re-reads to
   * tell 404 from 409).
   */
  setActive(
    type: ProviderType,
    id: string,
    active: boolean,
  ): Promise<ProviderSummary | null>;
}

interface ProviderDoc {
  _id: Types.ObjectId;
  name?: string;
  isActive?: boolean;
}

const PROJECTION = { name: 1, isActive: 1 } as const;

/**
 * Reads airlines/hotels through the raw collections, so this module does not
 * depend on teammates' schemas. A missing collection simply yields null.
 */
@Injectable()
export class MongoProviderDirectory implements ProviderDirectory {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async find(type: ProviderType, id: string): Promise<ProviderSummary | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const doc = await this.collection(type).findOne(
      { _id: new Types.ObjectId(id) },
      { projection: PROJECTION },
    );
    return doc ? toSummary(type, doc) : null;
  }

  async setActive(
    type: ProviderType,
    id: string,
    active: boolean,
  ): Promise<ProviderSummary | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    // A missing isActive counts as active, so "currently inactive" is exactly
    // `isActive: false` and "currently active" is anything else.
    const doc = await this.collection(type).findOneAndUpdate(
      {
        _id: new Types.ObjectId(id),
        isActive: active ? false : { $ne: false },
      },
      { $set: { isActive: active } },
      { returnDocument: 'after', projection: PROJECTION },
    );
    return doc ? toSummary(type, doc) : null;
  }

  private collection(type: ProviderType) {
    return this.connection.collection<ProviderDoc>(PROVIDER_COLLECTIONS[type]);
  }
}

function toSummary(type: ProviderType, doc: ProviderDoc): ProviderSummary {
  return {
    id: doc._id.toString(),
    type,
    name: doc.name ?? '',
    isActive: doc.isActive !== false,
  };
}
