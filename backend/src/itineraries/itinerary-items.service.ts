import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { MAX_IMAGES_PER_ITEM } from '../uploads/uploads.constants';
import { UploadsService } from '../uploads/uploads.service';
import {
  AddDayDto,
  CreateActivityDto,
  CreateBudgetEntryDto,
  CreateTransportEntryDto,
  LinkBookingDto,
  MoveDayDto,
  UpdateActivityDto,
  UpdateBudgetEntryDto,
  UpdateDayDto,
  UpdateTransportEntryDto,
} from './dto/itinerary-requests.dto';
import { COUNTED_STATUSES, linksOf } from './itinerary-bookings';
import { imageIdsOf, type ItineraryView } from './itinerary-view';
import {
  MAX_ACTIVITIES_PER_DAY,
  MAX_BOOKING_LINKS_PER_DAY,
  MAX_BUDGET_ENTRIES_PER_DAY,
  MAX_DAYS,
  MAX_TRANSPORT_ENTRIES,
} from './itineraries.constants';
import { ItinerariesService } from './itineraries.service';
import type {
  Activity,
  BudgetEntry,
  Day,
  LeanItinerary,
  TransportEntry,
} from './schemas/itinerary.schema';

const MAX_ACTIVITY_IMAGES = MAX_IMAGES_PER_ITEM.activity;

// Small finders that throw a clear 404.
function findDay(itinerary: LeanItinerary, dayId: string): Day {
  const day = itinerary.days!.find((d) => d._id.toString() === dayId);
  if (!day) throw new NotFoundException('Day not found');
  return day;
}

function findActivity(day: Day, activityId: string): Activity {
  const activity = day.activities.find((a) => a._id.toString() === activityId);
  if (!activity) throw new NotFoundException('Activity not found');
  return activity;
}

function findBudgetEntry(day: Day, entryId: string): BudgetEntry {
  const entry = day.budgetEntries.find((e) => e._id.toString() === entryId);
  if (!entry) throw new NotFoundException('Budget entry not found');
  return entry;
}

function findTransportEntry(
  itinerary: LeanItinerary,
  entryId: string,
): TransportEntry {
  const entry = itinerary.transportEntries!.find(
    (e) => e._id.toString() === entryId,
  );
  if (!entry) throw new NotFoundException('Transport entry not found');
  return entry;
}

/** Throws unless cost and currency are both set or both empty. */
function checkCostPair(cost: number | null, currency: string | null): void {
  if ((cost === null) !== (currency === null)) {
    throw new BadRequestException('cost and currency must be given together');
  }
}

/**
 * Days (ITN-05, ITN-07, ITN-08), activities and their images (ITN-10,
 * ITN-12), budget entries (ITN-14) and transport entries (ITN-16). Every
 * change goes through ItinerariesService.save, so parallel edits are safe,
 * and every method returns the whole updated itinerary.
 */
@Injectable()
export class ItineraryItemsService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly uploads: UploadsService,
  ) {}

  // ---------------------------------------------------------------- days

  /** ITN-05: add a day at the end, or at `position`. At most 60 days. */
  async addDay(
    id: string,
    viewer: AuthenticatedUser,
    dto: AddDayDto,
  ): Promise<ItineraryView> {
    await this.itineraries.checkCities(dto.cityId);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const days = itinerary.days!;
      if (days.length >= MAX_DAYS) {
        throw new BadRequestException(
          `An itinerary can have at most ${MAX_DAYS} days`,
        );
      }
      const position = dto.position ?? days.length + 1;
      if (position > days.length + 1) {
        throw new BadRequestException(
          `position must be between 1 and ${days.length + 1}`,
        );
      }
      days.splice(position - 1, 0, {
        _id: new Types.ObjectId(),
        cityId: dto.cityId,
        notes: dto.notes ?? '',
        activities: [],
        budgetEntries: [],
      });
    });
  }

  /** ITN-05: change a day's city or notes. */
  async updateDay(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
    dto: UpdateDayDto,
  ): Promise<ItineraryView> {
    if (dto.cityId === undefined && dto.notes === undefined) {
      throw new BadRequestException('Send cityId or notes');
    }
    if (dto.cityId !== undefined)
      await this.itineraries.checkCities(dto.cityId);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      if (dto.cityId !== undefined) day.cityId = dto.cityId;
      if (dto.notes !== undefined) day.notes = dto.notes;
    });
  }

  /**
   * ITN-07: delete a day (after confirmation). The remaining days renumber
   * and re-date themselves (both come from position). The day's transport
   * entries go with it, and its activity images are deleted (spec D7).
   */
  async removeDay(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    let removed: Day | undefined;
    const saved = await this.itineraries.save(id, viewer, (itinerary) => {
      const days = itinerary.days!;
      const index = days.findIndex((d) => d._id.toString() === dayId);
      if (index === -1) throw new NotFoundException('Day not found');
      [removed] = days.splice(index, 1);
      itinerary.transportEntries = itinerary.transportEntries!.filter(
        (t) => t.dayId.toString() !== dayId,
      );
    });
    await this.itineraries.deleteImages(imageIdsOf(removed ? [removed] : []));
    return this.itineraries.present(saved, viewer);
  }

  /** ITN-08: move a day to a new position. Numbers, dates and groups follow. */
  async moveDay(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
    dto: MoveDayDto,
  ): Promise<ItineraryView> {
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const days = itinerary.days!;
      const index = days.findIndex((d) => d._id.toString() === dayId);
      if (index === -1) throw new NotFoundException('Day not found');
      if (dto.position > days.length) {
        throw new BadRequestException(
          `position must be between 1 and ${days.length}`,
        );
      }
      const [day] = days.splice(index, 1);
      days.splice(dto.position - 1, 0, day);
    });
  }

  // ---------------------------------------------------------- activities

  /** ITN-10: name, description, optional time, optional cost + currency. */
  async addActivity(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
    dto: CreateActivityDto,
  ): Promise<ItineraryView> {
    const cost = dto.cost ?? null;
    const currency = dto.currency ?? null;
    checkCostPair(cost, currency);
    if (currency) await this.itineraries.checkCurrency(currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      if (day.activities.length >= MAX_ACTIVITIES_PER_DAY) {
        throw new BadRequestException(
          `A day can have at most ${MAX_ACTIVITIES_PER_DAY} activities`,
        );
      }
      day.activities.push({
        _id: new Types.ObjectId(),
        name: dto.name,
        description: dto.description ?? '',
        time: dto.time ?? null,
        cost,
        currency,
        images: [],
      });
    });
  }

  /** ITN-10: change any field; null clears time, or cost and currency. */
  async updateActivity(
    id: string,
    dayId: string,
    activityId: string,
    viewer: AuthenticatedUser,
    dto: UpdateActivityDto,
  ): Promise<ItineraryView> {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Send at least one field to change');
    }
    if (dto.currency) await this.itineraries.checkCurrency(dto.currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const activity = findActivity(findDay(itinerary, dayId), activityId);
      if (dto.name !== undefined) activity.name = dto.name;
      if (dto.description !== undefined) activity.description = dto.description;
      if (dto.time !== undefined) activity.time = dto.time;
      if (dto.cost === null) {
        // Clearing the cost clears its currency too.
        activity.cost = null;
        activity.currency = null;
      } else {
        if (dto.cost !== undefined) activity.cost = dto.cost;
        if (dto.currency !== undefined) activity.currency = dto.currency;
      }
      checkCostPair(activity.cost ?? null, activity.currency ?? null);
    });
  }

  /** ITN-10: delete an activity and its image files. */
  async removeActivity(
    id: string,
    dayId: string,
    activityId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    let imageIds: string[] = [];
    const saved = await this.itineraries.save(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      const activity = findActivity(day, activityId);
      imageIds = activity.images.map((i) => i.imageId);
      day.activities = day.activities.filter((a) => a !== activity);
    });
    await this.itineraries.deleteImages(imageIds);
    return this.itineraries.present(saved, viewer);
  }

  /**
   * ITN-12: attach an image (GEN-08: JPG/PNG, 5 MB, 5 per activity). The
   * file is stored once; if saving fails (limit reached by a parallel
   * upload, activity deleted, ...), the file is deleted again.
   */
  async addActivityImage(
    id: string,
    dayId: string,
    activityId: string,
    viewer: AuthenticatedUser,
    file: unknown,
  ): Promise<ItineraryView> {
    // Fail fast before storing anything.
    const current = await this.itineraries.loadOwned(id, viewer);
    current.days = current.days ?? [];
    const activity = findActivity(findDay(current, dayId), activityId);
    if (activity.images.length >= MAX_ACTIVITY_IMAGES) {
      throw new BadRequestException(
        `An activity can have at most ${MAX_ACTIVITY_IMAGES} images`,
      );
    }

    const stored = await this.uploads.upload(
      file,
      { type: 'activity', id: activityId },
      viewer.sub,
    );
    try {
      return await this.saveAndPresent(id, viewer, (itinerary) => {
        const target = findActivity(findDay(itinerary, dayId), activityId);
        if (target.images.length >= MAX_ACTIVITY_IMAGES) {
          throw new BadRequestException(
            `An activity can have at most ${MAX_ACTIVITY_IMAGES} images`,
          );
        }
        target.images.push({ imageId: stored.id, url: stored.url });
      });
    } catch (error) {
      await this.itineraries.deleteImages([stored.id]);
      throw error;
    }
  }

  /** ITN-12: remove an image from an activity, then delete its file. */
  async removeActivityImage(
    id: string,
    dayId: string,
    activityId: string,
    imageId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    const saved = await this.itineraries.save(id, viewer, (itinerary) => {
      const activity = findActivity(findDay(itinerary, dayId), activityId);
      if (!activity.images.some((i) => i.imageId === imageId)) {
        throw new NotFoundException('Image not found on this activity');
      }
      activity.images = activity.images.filter((i) => i.imageId !== imageId);
    });
    await this.itineraries.deleteImages([imageId]);
    return this.itineraries.present(saved, viewer);
  }

  // -------------------------------------------------------------- budget

  /** ITN-14: a non-negative amount in a supported currency, for one category. */
  async addBudgetEntry(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
    dto: CreateBudgetEntryDto,
  ): Promise<ItineraryView> {
    await this.itineraries.checkCurrency(dto.currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      if (day.budgetEntries.length >= MAX_BUDGET_ENTRIES_PER_DAY) {
        throw new BadRequestException(
          `A day can have at most ${MAX_BUDGET_ENTRIES_PER_DAY} budget entries`,
        );
      }
      day.budgetEntries.push({
        _id: new Types.ObjectId(),
        category: dto.category,
        amount: dto.amount,
        currency: dto.currency,
        note: dto.note ?? '',
      });
    });
  }

  async updateBudgetEntry(
    id: string,
    dayId: string,
    entryId: string,
    viewer: AuthenticatedUser,
    dto: UpdateBudgetEntryDto,
  ): Promise<ItineraryView> {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Send at least one field to change');
    }
    if (dto.currency !== undefined)
      await this.itineraries.checkCurrency(dto.currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const entry = findBudgetEntry(findDay(itinerary, dayId), entryId);
      if (dto.category !== undefined) entry.category = dto.category;
      if (dto.amount !== undefined) entry.amount = dto.amount;
      if (dto.currency !== undefined) entry.currency = dto.currency;
      if (dto.note !== undefined) entry.note = dto.note;
    });
  }

  async removeBudgetEntry(
    id: string,
    dayId: string,
    entryId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      const entry = findBudgetEntry(day, entryId);
      day.budgetEntries = day.budgetEntries.filter((e) => e !== entry);
    });
  }

  // ----------------------------------------------------------- transport

  /** ITN-16: mode, from-city, to-city, amount, currency, attached to a day. */
  async addTransportEntry(
    id: string,
    viewer: AuthenticatedUser,
    dto: CreateTransportEntryDto,
  ): Promise<ItineraryView> {
    await this.itineraries.checkCities(dto.fromCityId, dto.toCityId);
    await this.itineraries.checkCurrency(dto.currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      this.checkDayOf(itinerary, dto.dayId);
      if (itinerary.transportEntries!.length >= MAX_TRANSPORT_ENTRIES) {
        throw new BadRequestException(
          `An itinerary can have at most ${MAX_TRANSPORT_ENTRIES} transport entries`,
        );
      }
      itinerary.transportEntries!.push({
        _id: new Types.ObjectId(),
        dayId: new Types.ObjectId(dto.dayId),
        mode: dto.mode,
        fromCityId: dto.fromCityId,
        toCityId: dto.toCityId,
        amount: dto.amount,
        currency: dto.currency,
        note: dto.note ?? '',
      });
    });
  }

  async updateTransportEntry(
    id: string,
    entryId: string,
    viewer: AuthenticatedUser,
    dto: UpdateTransportEntryDto,
  ): Promise<ItineraryView> {
    if (Object.values(dto).every((v) => v === undefined)) {
      throw new BadRequestException('Send at least one field to change');
    }
    const cities = [dto.fromCityId, dto.toCityId].filter(
      (c): c is string => !!c,
    );
    if (cities.length > 0) await this.itineraries.checkCities(...cities);
    if (dto.currency !== undefined)
      await this.itineraries.checkCurrency(dto.currency);
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const entry = findTransportEntry(itinerary, entryId);
      if (dto.dayId !== undefined) {
        this.checkDayOf(itinerary, dto.dayId);
        entry.dayId = new Types.ObjectId(dto.dayId);
      }
      if (dto.mode !== undefined) entry.mode = dto.mode;
      if (dto.fromCityId !== undefined) entry.fromCityId = dto.fromCityId;
      if (dto.toCityId !== undefined) entry.toCityId = dto.toCityId;
      if (dto.amount !== undefined) entry.amount = dto.amount;
      if (dto.currency !== undefined) entry.currency = dto.currency;
      if (dto.note !== undefined) entry.note = dto.note;
    });
  }

  async removeTransportEntry(
    id: string,
    entryId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const entry = findTransportEntry(itinerary, entryId);
      itinerary.transportEntries = itinerary.transportEntries!.filter(
        (e) => e !== entry,
      );
    });
  }

  // ----------------------------------------------- linked bookings (ITN-27)

  /**
   * ITN-27 (bonus): link one of the owner's own Confirmed (or Completed)
   * flight bookings or hotel reservations to a day, so its price feeds the
   * budget. Someone else's or an unknown booking is 404; any other status
   * is 409; the same booking can be linked once per itinerary (409).
   */
  async linkBooking(
    id: string,
    dayId: string,
    viewer: AuthenticatedUser,
    dto: LinkBookingDto,
  ): Promise<ItineraryView> {
    // Ownership of the itinerary first, so others get the usual 404 / 403.
    await this.itineraries.loadOwned(id, viewer);
    const booking = await this.itineraries.findOwnBooking(
      viewer,
      dto.type,
      dto.bookingId,
    );
    if (!booking) throw new NotFoundException('Booking not found');
    if (!COUNTED_STATUSES.includes(booking.status)) {
      throw new ConflictException(
        'Only Confirmed or Completed bookings can be linked',
      );
    }
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      const already = linksOf(itinerary).some(
        ({ link }) =>
          link.type === dto.type && link.bookingId.toString() === dto.bookingId,
      );
      if (already) {
        throw new ConflictException(
          'This booking is already linked to this itinerary',
        );
      }
      day.bookingLinks ??= [];
      if (day.bookingLinks.length >= MAX_BOOKING_LINKS_PER_DAY) {
        throw new BadRequestException(
          `A day can have at most ${MAX_BOOKING_LINKS_PER_DAY} linked bookings`,
        );
      }
      day.bookingLinks.push({
        _id: new Types.ObjectId(),
        type: dto.type,
        bookingId: new Types.ObjectId(dto.bookingId),
      });
    });
  }

  /** ITN-27: unlink a booking from a day (the booking itself is untouched). */
  async unlinkBooking(
    id: string,
    dayId: string,
    linkId: string,
    viewer: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.saveAndPresent(id, viewer, (itinerary) => {
      const day = findDay(itinerary, dayId);
      const links = day.bookingLinks ?? [];
      if (!links.some((l) => l._id.toString() === linkId)) {
        throw new NotFoundException('Linked booking not found');
      }
      day.bookingLinks = links.filter((l) => l._id.toString() !== linkId);
    });
  }

  // ------------------------------------------------------------- helpers

  private checkDayOf(itinerary: LeanItinerary, dayId: string): void {
    if (!itinerary.days!.some((d) => d._id.toString() === dayId)) {
      throw new BadRequestException('dayId is not a day of this itinerary');
    }
  }

  private async saveAndPresent(
    id: string,
    viewer: AuthenticatedUser,
    change: (itinerary: LeanItinerary) => void,
  ): Promise<ItineraryView> {
    const saved = await this.itineraries.save(id, viewer, change);
    return this.itineraries.present(saved, viewer);
  }
}
