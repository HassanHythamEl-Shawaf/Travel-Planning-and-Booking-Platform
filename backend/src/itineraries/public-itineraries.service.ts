import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { getPagination, type Paginated } from '../common/pagination';
import { containsInsensitive } from '../common/regex';
import { USERS_COLLECTION } from '../integrations/teammate-contracts';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { UploadsService } from '../uploads/uploads.service';
import { AccountStatus } from '../users/schemas/user.schema';
import { SearchItinerariesQueryDto } from './dto/itinerary-requests.dto';
import type { ItineraryListItemDto } from './dto/itinerary-responses.dto';
import type { ItineraryView } from './itinerary-view';
import { ItinerariesService, type OwnerInfo } from './itineraries.service';
import { DELETED_USER_NAME } from './itineraries.constants';
import type {
  Activity,
  Day,
  LeanItinerary,
  TransportEntry,
} from './schemas/itinerary.schema';

/** Upper bounds on reference-data matches for a keyword (keeps $in small). */
const MAX_KEYWORD_COUNTRIES = 300;
const MAX_KEYWORD_CITIES = 1000;

type SearchRow = LeanItinerary & { dayCount: number; owner: OwnerInfo };

/**
 * ITN-21: public search for guests and users, and cloning a public
 * itinerary into a private copy that credits the original author.
 */
@Injectable()
export class PublicItinerariesService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly uploads: UploadsService,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
  ) {}

  /**
   * Public itineraries only: not private, not hidden (GEN-10), and not by
   * a deactivated user (ACC-12). Newest first, 10 per page (GEN-05).
   */
  async search(
    query: SearchItinerariesQueryDto,
  ): Promise<Paginated<ItineraryListItemDto>> {
    const { page, limit, skip } = getPagination(query.page ?? 1);
    if (
      query.minDays !== undefined &&
      query.maxDays !== undefined &&
      query.minDays > query.maxDays
    ) {
      throw new BadRequestException('minDays cannot be greater than maxDays');
    }

    const conditions: Record<string, unknown>[] = [
      { isPublic: true },
      { isHidden: { $ne: true } },
    ];
    if (query.q) conditions.push(await this.keywordCondition(query.q));
    if (query.country) conditions.push({ countries: query.country });
    if (query.cityId) conditions.push({ 'days.cityId': query.cityId });

    const dayCount = { $size: { $ifNull: ['$days', []] } };
    const range: Record<string, unknown>[] = [];
    if (query.minDays !== undefined)
      range.push({ $gte: [dayCount, query.minDays] });
    if (query.maxDays !== undefined)
      range.push({ $lte: [dayCount, query.maxDays] });
    if (range.length > 0) conditions.push({ $expr: { $and: range } });

    const pipeline: PipelineStage[] = [
      { $match: { $and: conditions } },
      // ACC-12: drop itineraries whose owner is deactivated (or gone).
      {
        $lookup: {
          from: USERS_COLLECTION,
          localField: 'ownerId',
          foreignField: '_id',
          as: 'owner',
          pipeline: [{ $project: { name: 1, status: 1 } }],
        },
      },
      { $unwind: '$owner' },
      { $match: { 'owner.status': { $ne: AccountStatus.DEACTIVATED } } },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                title: 1,
                countries: 1,
                startDate: 1,
                isPublic: 1,
                isHidden: 1,
                ownerId: 1,
                owner: 1,
                createdAt: 1,
                updatedAt: 1,
                dayCount,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await this.itineraries.model
      .aggregate<{ items: SearchRow[]; total: { count: number }[] }>(pipeline)
      .exec();
    const total = result?.total[0]?.count ?? 0;
    const items = await this.itineraries.toListItems(result?.items ?? []);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  /**
   * ITN-21: copies all days, activities, budget and transport entries into
   * a new private itinerary owned by the viewer. It credits the author of
   * the itinerary that was copied, and is independent: images are copied
   * as new files, so deleting the original never affects the clone.
   */
  async clone(id: string, viewer: AuthenticatedUser): Promise<ItineraryView> {
    const { itinerary: original, owner } = await this.itineraries.loadViewable(
      id,
      viewer,
    );
    if (!original.startDate || !original.countries?.length) {
      throw new BadRequestException('This itinerary cannot be cloned');
    }

    const copiedImageIds: string[] = [];
    try {
      const dayIds = new Map<string, Types.ObjectId>();
      const days: Day[] = [];
      for (const day of original.days ?? []) {
        const newDayId = new Types.ObjectId();
        dayIds.set(day._id.toString(), newDayId);
        const activities: Activity[] = [];
        for (const activity of day.activities ?? []) {
          activities.push(
            await this.copyActivity(activity, viewer, copiedImageIds),
          );
        }
        days.push({
          _id: newDayId,
          cityId: day.cityId,
          notes: day.notes ?? '',
          activities,
          budgetEntries: (day.budgetEntries ?? []).map((e) => ({
            _id: new Types.ObjectId(),
            category: e.category,
            amount: e.amount,
            currency: e.currency,
            note: e.note ?? '',
          })),
        });
      }
      const transportEntries: TransportEntry[] = (
        original.transportEntries ?? []
      )
        .filter((t) => dayIds.has(t.dayId.toString()))
        .map((t) => ({
          _id: new Types.ObjectId(),
          dayId: dayIds.get(t.dayId.toString())!,
          mode: t.mode,
          fromCityId: t.fromCityId,
          toCityId: t.toCityId,
          amount: t.amount,
          currency: t.currency,
          note: t.note ?? '',
        }));

      const created = await this.itineraries.model.create({
        ownerId: new Types.ObjectId(viewer.sub),
        title: original.title,
        countries: original.countries,
        startDate: original.startDate,
        isPublic: false,
        isHidden: false,
        days,
        transportEntries,
        clonedFrom: {
          itineraryId: original._id,
          authorId: original.ownerId,
          authorName: owner?.name ?? DELETED_USER_NAME,
        },
        version: 0,
      });
      return this.itineraries.present(
        created.toObject() as LeanItinerary,
        viewer,
      );
    } catch (error) {
      // Nothing was saved: remove the image copies again.
      await this.itineraries.deleteImages(copiedImageIds);
      throw error;
    }
  }

  /** A copy of an activity with a new id and its own copies of the images. */
  private async copyActivity(
    activity: Activity,
    viewer: AuthenticatedUser,
    copiedImageIds: string[],
  ): Promise<Activity> {
    const newId = new Types.ObjectId();
    const images: Activity['images'] = [];
    for (const image of activity.images ?? []) {
      const copy = await this.uploads.copy(
        image.imageId,
        { type: 'activity', id: newId.toString() },
        viewer.sub,
      );
      if (copy) {
        copiedImageIds.push(copy.id);
        images.push({ imageId: copy.id, url: copy.url });
      }
    }
    return {
      _id: newId,
      name: activity.name,
      description: activity.description ?? '',
      time: activity.time ?? null,
      cost: activity.cost ?? null,
      currency: activity.currency ?? null,
      images,
    };
  }

  /** Keyword over the title, country names/codes and city names (ITN-21). */
  private async keywordCondition(q: string): Promise<Record<string, unknown>> {
    const regex = containsInsensitive(q);
    const [countries, cities] = await Promise.all([
      this.countryModel
        .find({ $or: [{ name: regex }, { _id: q.toUpperCase() }] }, { _id: 1 })
        .limit(MAX_KEYWORD_COUNTRIES)
        .lean<{ _id: string }[]>()
        .exec(),
      this.cityModel
        .find({ name: regex }, { _id: 1 })
        .limit(MAX_KEYWORD_CITIES)
        .lean<{ _id: string }[]>()
        .exec(),
    ]);
    return {
      $or: [
        { title: regex },
        { countries: { $in: countries.map((c) => c._id) } },
        { 'days.cityId': { $in: cities.map((c) => c._id) } },
      ],
    };
  }
}
