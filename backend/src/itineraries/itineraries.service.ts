import { setTimeout as sleep } from 'node:timers/promises';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { getPagination, type Paginated } from '../common/pagination';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { Currency } from '../reference-data/schemas/currency.schema';
import { ReportStatus } from '../reports/report.constants';
import { Report } from '../reports/schemas/report.schema';
import { UploadsService } from '../uploads/uploads.service';
import { AccountStatus, User } from '../users/schemas/user.schema';
import {
  ConfirmDto,
  CreateItineraryDto,
  UpdateItineraryDto,
  VisibilityDto,
} from './dto/itinerary-requests.dto';
import type {
  ItineraryDeletedDto,
  ItineraryListItemDto,
} from './dto/itinerary-responses.dto';
import { canViewItinerary, isOwnerOf, type Viewer } from './itinerary-access';
import {
  cityIdsOf,
  imageIdsOf,
  type ItineraryView,
  parseDateOnly,
  personRef,
  toDateOnly,
  toItineraryView,
} from './itinerary-view';
import {
  DELETED_BY_OWNER_NOTE,
  MAX_SAVE_ATTEMPTS,
} from './itineraries.constants';
import { Itinerary, type LeanItinerary } from './schemas/itinerary.schema';

/** Owner fields needed for access checks and author names. */
export interface OwnerInfo {
  _id: Types.ObjectId;
  name: string;
  status?: string;
}

export const NOT_FOUND = 'Itinerary not found';
export const NOT_OWNER = 'Only the owner can change this itinerary';
export const CONFLICT =
  'The itinerary was changed by another request at the same time; please try again';

/**
 * Itineraries (ITN-01, ITN-03, ITN-20) plus the helpers every itinerary
 * write uses: access checks, reference-data checks, and `save`, the
 * read-modify-write loop that keeps parallel edits safe (spec D9).
 */
@Injectable()
export class ItinerariesService {
  private readonly logger = new Logger(ItinerariesService.name);

  constructor(
    @InjectModel(Itinerary.name) readonly model: Model<Itinerary>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    @InjectModel(Currency.name) private readonly currencyModel: Model<Currency>,
    @InjectModel(Report.name) private readonly reportModel: Model<Report>,
    @InjectConnection() private readonly connection: Connection,
    private readonly uploads: UploadsService,
  ) {}

  // ------------------------------------------------------------ itinerary

  /** ITN-01: private by default, no days yet. */
  async create(
    viewer: AuthenticatedUser,
    dto: CreateItineraryDto,
  ): Promise<ItineraryView> {
    const countries = await this.checkCountries(dto.countries);
    const created = await this.model.create({
      ownerId: new Types.ObjectId(viewer.sub),
      title: dto.title,
      countries,
      startDate: parseDateOnly(dto.startDate),
      isPublic: false,
      isHidden: false,
      days: [],
      transportEntries: [],
      clonedFrom: null,
      version: 0,
    });
    return this.present(created.toObject() as LeanItinerary, viewer);
  }

  /** ITN-03: my itineraries, most recently updated first, 10 per page. */
  async listMine(
    viewer: AuthenticatedUser,
    page?: number,
  ): Promise<Paginated<ItineraryListItemDto>> {
    const { limit, skip, page: current } = getPagination(page ?? 1);
    const filter = { ownerId: new Types.ObjectId(viewer.sub) };
    const [rows, total, me] = await Promise.all([
      this.model
        .find(filter, { days: 0, transportEntries: 0 })
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean<LeanItinerary[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
      this.findOwner(new Types.ObjectId(viewer.sub)),
    ]);
    // Day counts without loading every day.
    const counts = await this.dayCounts(rows.map((r) => r._id));
    const items = await this.toListItems(
      rows.map((r) => ({
        ...r,
        dayCount: counts.get(r._id.toString()) ?? 0,
        owner: me,
      })),
    );
    return {
      items,
      page: current,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** ITN-03 / ITN-21: one itinerary, if the viewer may see it (404 otherwise). */
  async findOne(id: string, viewer: Viewer): Promise<ItineraryView> {
    const { itinerary } = await this.loadViewable(id, viewer);
    return this.present(itinerary, viewer);
  }

  /** ITN-01: edit title, countries and start date (days follow the new date). */
  async update(
    id: string,
    viewer: AuthenticatedUser,
    dto: UpdateItineraryDto,
  ): Promise<ItineraryView> {
    if (
      dto.title === undefined &&
      dto.countries === undefined &&
      dto.startDate === undefined
    ) {
      throw new BadRequestException(
        'Send at least one of title, countries or startDate',
      );
    }
    const itinerary = await this.loadOwned(id, viewer);
    const set: Record<string, unknown> = {};
    if (dto.title !== undefined) set.title = dto.title;
    if (dto.countries !== undefined)
      set.countries = await this.checkCountries(dto.countries);
    if (dto.startDate !== undefined)
      set.startDate = parseDateOnly(dto.startDate);
    return this.setFields(itinerary, set, viewer);
  }

  /** ITN-20: Public or Private. Private removes it from search at once. */
  async setVisibility(
    id: string,
    viewer: AuthenticatedUser,
    dto: VisibilityDto,
  ): Promise<ItineraryView> {
    const itinerary = await this.loadOwned(id, viewer);
    return this.setFields(itinerary, { isPublic: dto.isPublic }, viewer);
  }

  /**
   * ITN-01 delete, after confirmation (GEN-03). In one transaction: the
   * itinerary goes, and open reports on it are closed as content_deleted.
   * Clones made by others are separate documents and are not touched.
   * Activity image files are removed after the commit.
   */
  async remove(
    id: string,
    viewer: AuthenticatedUser,
    _confirm: ConfirmDto,
  ): Promise<ItineraryDeletedDto> {
    const itinerary = await this.loadOwned(id, viewer);
    let deleted: LeanItinerary | null = null;
    await this.connection.transaction(async (session) => {
      deleted = await this.model
        .findOneAndDelete(
          { _id: itinerary._id, ownerId: itinerary.ownerId },
          { session },
        )
        .lean<LeanItinerary>()
        .exec();
      if (!deleted) throw new NotFoundException(NOT_FOUND);
      await this.closeOpenReports(itinerary._id, session);
    });
    await this.deleteImages(
      imageIdsOf((deleted as LeanItinerary | null)?.days),
    );
    return { id, deleted: true };
  }

  // -------------------------------------------------------------- access

  /** 404 if missing or not visible to the viewer. */
  async loadViewable(
    id: string,
    viewer: Viewer,
  ): Promise<{ itinerary: LeanItinerary; owner: OwnerInfo | null }> {
    const itinerary = await this.model
      .findById(id)
      .lean<LeanItinerary>()
      .exec();
    if (!itinerary) throw new NotFoundException(NOT_FOUND);
    const owner = await this.findOwner(itinerary.ownerId);
    if (!canViewItinerary(itinerary, owner, viewer)) {
      throw new NotFoundException(NOT_FOUND);
    }
    return { itinerary, owner };
  }

  /** For owner-only actions: 404 if the viewer can't see it, 403 if they can but don't own it. */
  async loadOwned(
    id: string,
    viewer: AuthenticatedUser,
  ): Promise<LeanItinerary> {
    const { itinerary } = await this.loadViewable(id, viewer);
    if (!isOwnerOf(itinerary, viewer)) throw new ForbiddenException(NOT_OWNER);
    return itinerary;
  }

  findOwner(ownerId: Types.ObjectId): Promise<OwnerInfo | null> {
    return this.userModel
      .findById(ownerId, { name: 1, status: 1 })
      .lean<OwnerInfo>()
      .exec();
  }

  // ---------------------------------------------------------------- save

  /**
   * Read-modify-write for days and entries (spec D9). Loads the itinerary,
   * lets `change` edit `days` / `transportEntries` in memory, then saves
   * only those fields, and only if nobody else saved in between (same
   * `version`). If someone did, it reloads and tries again, so parallel
   * requests never overwrite each other. Returns the saved itinerary.
   */
  async save(
    id: string,
    viewer: AuthenticatedUser,
    change: (itinerary: LeanItinerary) => void,
  ): Promise<LeanItinerary> {
    for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
      const itinerary = await this.loadOwned(id, viewer);
      itinerary.days = itinerary.days ?? [];
      itinerary.transportEntries = itinerary.transportEntries ?? [];
      change(itinerary);

      const version = itinerary.version;
      const result = await this.model
        .updateOne(
          {
            _id: itinerary._id,
            ownerId: itinerary.ownerId,
            // Older raw documents have no version field yet.
            version: version === undefined ? { $exists: false } : version,
          },
          {
            $set: {
              days: itinerary.days,
              transportEntries: itinerary.transportEntries,
              version: (version ?? 0) + 1,
            },
          },
          { runValidators: true },
        )
        .exec();
      if (result.matchedCount === 1) {
        return (await this.model
          .findById(itinerary._id)
          .lean<LeanItinerary>()
          .exec())!;
      }
      // Someone else saved first: wait a little (random, so parallel
      // requests don't collide again) and retry with fresh data.
      await sleep(5 + Math.floor(Math.random() * 20));
    }
    throw new ConflictException(CONFLICT);
  }

  // ------------------------------------------------------- reference data

  /** Removes duplicates; 400 if a code is not in the reference data. */
  async checkCountries(codes: string[]): Promise<string[]> {
    const unique = [...new Set(codes)];
    const found = await this.countryModel
      .find({ _id: { $in: unique } }, { _id: 1 })
      .lean<{ _id: string }[]>()
      .exec();
    const known = new Set(found.map((c) => c._id));
    const unknown = unique.filter((code) => !known.has(code));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown country: ${unknown.join(', ')}`);
    }
    return unique;
  }

  /** ITN-05: the city must be in the predefined list (shared with hotels and airports). */
  async checkCities(...cityIds: string[]): Promise<void> {
    const unique = [...new Set(cityIds)];
    const count = await this.cityModel
      .countDocuments({ _id: { $in: unique } })
      .exec();
    if (count !== unique.length) {
      const found = await this.cityModel
        .find({ _id: { $in: unique } }, { _id: 1 })
        .lean<{ _id: string }[]>()
        .exec();
      const known = new Set(found.map((c) => c._id));
      throw new BadRequestException(
        `Unknown city: ${unique.filter((id) => !known.has(id)).join(', ')}`,
      );
    }
  }

  /** Budget amounts use the supported currencies seeded from Countries.csv. */
  async checkCurrency(code: string): Promise<void> {
    if ((await this.currencyModel.exists({ _id: code }).exec()) === null) {
      throw new BadRequestException(`Unsupported currency: ${code}`);
    }
  }

  // ------------------------------------------------------------- present

  /** Builds the full view, looking up names in a few queries. */
  async present(
    itinerary: LeanItinerary,
    viewer: Viewer,
  ): Promise<ItineraryView> {
    const cityIds = cityIdsOf(itinerary);
    const [owner, cloneAuthor, cities, countries] = await Promise.all([
      this.findOwner(itinerary.ownerId),
      itinerary.clonedFrom
        ? this.findOwner(itinerary.clonedFrom.authorId)
        : null,
      this.cityModel
        .find({ _id: { $in: cityIds } }, { name: 1 })
        .lean<{ _id: string; name: string }[]>()
        .exec(),
      this.countryNames(itinerary.countries ?? []),
    ]);
    return toItineraryView(itinerary, {
      isOwner: isOwnerOf(itinerary, viewer),
      author: owner
        ? {
            id: owner._id.toString(),
            name: owner.name,
            deactivated: owner.status === AccountStatus.DEACTIVATED,
          }
        : null,
      // The name stored at clone time is used if the account no longer exists.
      cloneAuthor: itinerary.clonedFrom
        ? cloneAuthor
          ? {
              name: cloneAuthor.name,
              deactivated: cloneAuthor.status === AccountStatus.DEACTIVATED,
            }
          : null
        : null,
      cityNames: new Map(cities.map((c) => [c._id, c.name])),
      countryNames: countries,
    });
  }

  /** List rows: countries with names and the author. */
  async toListItems(
    rows: (LeanItinerary & { dayCount: number; owner: OwnerInfo | null })[],
  ): Promise<ItineraryListItemDto[]> {
    const names = await this.countryNames(
      rows.flatMap((r) => r.countries ?? []),
    );
    return rows.map((r) => ({
      id: r._id.toString(),
      title: r.title,
      countries: (r.countries ?? []).map((code) => ({
        code,
        name: names.get(code) ?? null,
      })),
      startDate: r.startDate ? toDateOnly(r.startDate) : null,
      dayCount: r.dayCount,
      isPublic: r.isPublic === true,
      isHidden: r.isHidden === true,
      author: personRef(
        r.ownerId,
        r.owner
          ? {
              name: r.owner.name,
              deactivated: r.owner.status === AccountStatus.DEACTIVATED,
            }
          : null,
      ),
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    }));
  }

  /** Activity image files, removed after the database change (best effort). */
  async deleteImages(imageIds: string[]): Promise<void> {
    for (const imageId of imageIds) {
      try {
        await this.uploads.delete(imageId);
      } catch {
        this.logger.warn(`Could not delete activity image ${imageId}`);
      }
    }
  }

  // ------------------------------------------------------------- private

  /** Sets itinerary-level fields only (never days), so it can't undo a day edit. */
  private async setFields(
    itinerary: LeanItinerary,
    set: Record<string, unknown>,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    const updated = await this.model
      .findOneAndUpdate(
        { _id: itinerary._id, ownerId: itinerary.ownerId },
        { $set: set },
        { returnDocument: 'after', runValidators: true },
      )
      .lean<LeanItinerary>()
      .exec();
    if (!updated) throw new NotFoundException(NOT_FOUND);
    return this.present(updated, viewer);
  }

  private async closeOpenReports(
    itineraryId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    await this.reportModel
      .updateMany(
        {
          status: ReportStatus.OPEN,
          targetType: 'itinerary',
          targetId: itineraryId,
        },
        {
          $set: {
            status: ReportStatus.CONTENT_DELETED,
            resolvedBy: null,
            resolvedAt: new Date(),
            resolutionNote: DELETED_BY_OWNER_NOTE,
          },
        },
        { session },
      )
      .exec();
  }

  private async countryNames(codes: string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const found = await this.countryModel
      .find({ _id: { $in: [...new Set(codes)] } }, { name: 1 })
      .lean<{ _id: string; name: string }[]>()
      .exec();
    return new Map(found.map((c) => [c._id, c.name]));
  }

  private async dayCounts(ids: Types.ObjectId[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.model
      .aggregate<{ _id: Types.ObjectId; dayCount: number }>([
        { $match: { _id: { $in: ids } } },
        { $project: { dayCount: { $size: { $ifNull: ['$days', []] } } } },
      ])
      .exec();
    return new Map(rows.map((r) => [r._id.toString(), r.dayCount]));
  }
}
