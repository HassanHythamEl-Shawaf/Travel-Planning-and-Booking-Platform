import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';

import { ModerationRegistry } from '../moderation/moderation.registry';
import {
  type ModerationHandler,
  type ModeratableContent,
  toExcerpt,
} from '../moderation/moderation.types';
import { UploadsService } from '../uploads/uploads.service';
import { imageIdsOf } from './itinerary-view';
import { Itinerary, type LeanItinerary } from './schemas/itinerary.schema';

const toObjectId = (id: string): Types.ObjectId | null =>
  /^[0-9a-fA-F]{24}$/.test(id) ? new Types.ObjectId(id) : null;

/**
 * GEN-09 / GEN-10 handler for itineraries, replacing the raw default (which
 * had no delete). Rules from the moderation registry: every write uses the
 * given session, setHidden is conditional on the current state, no
 * notifications here, and files are removed only in afterDelete. Works with
 * documents that only have the contract fields (ownerId, title, isPublic,
 * isHidden), as some tests insert them that way.
 */
export class ItineraryModerationHandler implements ModerationHandler {
  private readonly logger = new Logger(ItineraryModerationHandler.name);

  constructor(
    private readonly model: Model<Itinerary>,
    private readonly uploads: UploadsService,
  ) {}

  async find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null> {
    const _id = toObjectId(id);
    if (!_id) return null;
    const itinerary = await this.model
      .findById(_id)
      .session(session ?? null)
      .lean<LeanItinerary>()
      .exec();
    if (!itinerary) return null;
    const isHidden = itinerary.isHidden === true;
    return {
      id,
      type: 'itinerary',
      authorId: itinerary.ownerId?.toString() ?? '',
      isHidden,
      publiclyVisible: itinerary.isPublic === true && !isHidden,
      // Itineraries have no free text of their own; the title is the excerpt.
      snapshot: { title: itinerary.title, excerpt: toExcerpt(itinerary.title) },
      assets: imageIdsOf(itinerary.days),
    };
  }

  /** Matches only if the state actually changes; a missing isHidden counts as visible. */
  async setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.model
      .updateOne(
        { _id, isHidden: hidden ? { $ne: true } : true },
        { $set: { isHidden: hidden } },
        { session },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** Admin delete. Reports on it are resolved by the moderation service. */
  async delete(id: string, session: ClientSession): Promise<boolean> {
    const _id = toObjectId(id);
    if (!_id) return false;
    const result = await this.model.deleteOne({ _id }, { session }).exec();
    return result.deletedCount === 1;
  }

  /** After the commit: remove the activity image files (best effort). */
  async afterDelete(content: ModeratableContent): Promise<void> {
    for (const imageId of content.assets ?? []) {
      try {
        await this.uploads.delete(imageId);
      } catch {
        this.logger.warn(`Could not delete activity image ${imageId}`);
      }
    }
  }
}

/** Registers the itinerary handler at startup. */
@Injectable()
export class ItineraryModerationRegistration implements OnModuleInit {
  constructor(
    private readonly registry: ModerationRegistry,
    @InjectModel(Itinerary.name) private readonly model: Model<Itinerary>,
    private readonly uploads: UploadsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(
      'itinerary',
      new ItineraryModerationHandler(this.model, this.uploads),
    );
  }
}
