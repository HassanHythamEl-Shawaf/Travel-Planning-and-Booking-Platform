import { BadRequestException, Injectable } from '@nestjs/common';

import { AirlinesService } from '../airlines/airlines.service';
import type { FlightSearchResponseDto } from '../airlines/dto/flight-search.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { getPagination, type Paginated } from '../common/pagination';
import { HotelsService } from '../hotels/hotels.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  ItineraryFlightQueryDto,
  ItineraryHotelQueryDto,
} from './dto/itinerary-search.dto';
import {
  addDays,
  buildCityGroups,
  dayDate,
  toDateOnly,
} from './itinerary-view';
import { ItinerariesService } from './itineraries.service';

/** Seif's search returns at most 50 hotels per page; we read up to this many pages. */
const HOTEL_PAGE_SIZE = 50;
const MAX_HOTEL_PAGES = 20;

interface AvailableRoom {
  _id: unknown;
  name: string;
  pricePerNight: number;
  occupancy?: { maxAdults?: number; maxChildren?: number };
}

interface HotelResult {
  _id: unknown;
  name: string;
  address?: string;
  city: string;
  country: string;
  averageRating?: number;
  photos?: string[];
  startingPrice: number;
  availableRooms: AvailableRoom[];
}

/** A room's maximum occupancy: adults plus children. */
const capacity = (room: AvailableRoom) =>
  (room.occupancy?.maxAdults ?? 0) + (room.occupancy?.maxChildren ?? 0);

/**
 * HTL-11 rule used by ITN-25: the hotel has at least `rooms` free rooms
 * whose combined maximum occupancy covers `guests`. Taking the biggest
 * rooms gives the largest possible total, so it is enough to check those.
 */
export function hasRoomsFor(
  available: AvailableRoom[],
  rooms: number,
  guests: number,
): boolean {
  if (available.length < rooms) return false;
  const biggest = available
    .map(capacity)
    .sort((a, b) => b - a)
    .slice(0, rooms);
  return biggest.reduce((sum, c) => sum + c, 0) >= guests;
}

export interface HotelStay {
  group: number;
  cityId: string;
  cityName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  rooms: number;
}

export interface ItineraryHotel {
  id: string;
  name: string;
  address: string;
  city: string;
  country: string;
  averageRating: number;
  photos: string[];
  startingPrice: number;
  availableRoomCount: number;
  rooms: {
    id: string;
    name: string;
    pricePerNight: number;
    maxAdults: number;
    maxChildren: number;
  }[];
}

/**
 * ITN-25 and ITN-26: hotel and flight lookups for an itinerary. They reuse
 * the hotel search (Seif, HTL-11) and the flight search (Yahia, FLT-11 /
 * FLT-12) instead of repeating their availability logic.
 */
@Injectable()
export class ItinerarySearchService {
  constructor(
    private readonly itineraries: ItinerariesService,
    private readonly hotels: HotelsService,
    private readonly airlines: AirlinesService,
    private readonly referenceData: ReferenceDataService,
  ) {}

  /**
   * ITN-25: hotels in a city group's city for the group's dates
   * (check-in = first day, check-out = the day after the last day), with
   * at least `rooms` free rooms whose combined occupancy covers `guests`.
   */
  async hotelsForGroup(
    id: string,
    viewer: AuthenticatedUser,
    query: ItineraryHotelQueryDto,
  ): Promise<Paginated<ItineraryHotel> & { stay: HotelStay }> {
    const { page, limit, skip } = getPagination(query.page ?? 1);
    if (query.rooms > query.guests) {
      throw new BadRequestException('rooms cannot be more than guests');
    }

    const itinerary = await this.itineraries.loadOwned(id, viewer);
    const groups = buildCityGroups(itinerary, new Map());
    const group = groups[query.group - 1];
    if (!group || !itinerary.startDate) {
      throw new BadRequestException(
        `group must be between 1 and ${groups.length} (the itinerary's city groups)`,
      );
    }
    // Hotels store the city as free text, so search by the city's name.
    const city = await this.referenceData.findCity(group.cityId);
    const cityName = city?.name ?? group.cityId;

    const checkIn = group.startDate!;
    const checkOut = toDateOnly(
      addDays(itinerary.startDate, group.lastDayNumber),
    );
    if (checkIn < toDateOnly(new Date())) {
      throw new BadRequestException('This city group starts in the past');
    }

    // All hotels Seif's search finds for the city and dates (it already
    // drops inactive hotels and rooms that are booked or blocked).
    const found: HotelResult[] = [];
    for (let p = 1; p <= MAX_HOTEL_PAGES; p++) {
      const result = await this.hotels.searchHotels({
        destination: cityName,
        startDate: checkIn,
        endDate: checkOut,
        page: p,
        limit: HOTEL_PAGE_SIZE,
      });
      found.push(...(result.data as unknown as HotelResult[]));
      if (p >= result.totalPages) break;
    }

    // Hotel city is free text: keep exact (case-insensitive) city matches,
    // then apply the "N rooms for the guests" rule.
    const matching = found.filter(
      (hotel) =>
        hotel.city?.trim().toLowerCase() === cityName.toLowerCase() &&
        hasRoomsFor(hotel.availableRooms, query.rooms, query.guests),
    );

    const items = matching.slice(skip, skip + limit).map((hotel) => ({
      id: String(hotel._id),
      name: hotel.name,
      address: hotel.address ?? '',
      city: hotel.city,
      country: hotel.country,
      averageRating: hotel.averageRating ?? 0,
      photos: hotel.photos ?? [],
      startingPrice: hotel.startingPrice,
      availableRoomCount: hotel.availableRooms.length,
      rooms: hotel.availableRooms.map((room) => ({
        id: String(room._id),
        name: room.name,
        pricePerNight: room.pricePerNight,
        maxAdults: room.occupancy?.maxAdults ?? 0,
        maxChildren: room.occupancy?.maxChildren ?? 0,
      })),
    }));

    return {
      stay: {
        group: query.group,
        cityId: group.cityId,
        cityName,
        checkIn,
        checkOut,
        nights: group.dayCount,
        guests: query.guests,
        rooms: query.rooms,
      },
      items,
      page,
      limit,
      total: matching.length,
      totalPages: Math.ceil(matching.length / limit),
    };
  }

  /** ITN-26: the airports in the city of the itinerary's first day. */
  async arrivalAirports(
    id: string,
    viewer: AuthenticatedUser,
  ): Promise<{
    cityId: string;
    cityName: string;
    airports: { code: string; name: string }[];
  }> {
    const itinerary = await this.itineraries.loadOwned(id, viewer);
    const firstCityId = itinerary.days?.[0]?.cityId;
    if (!firstCityId) {
      throw new BadRequestException(
        'Add a day first: flights go to the city of day 1',
      );
    }
    const [city, airports] = await Promise.all([
      this.referenceData.findCity(firstCityId),
      this.referenceData.getAirportsInCity(firstCityId),
    ]);
    return {
      cityId: firstCityId,
      cityName: city?.name ?? firstCityId,
      airports: airports.map((a) => ({ code: a._id, name: a.name })),
    };
  }

  /**
   * ITN-26: one-way or round-trip flights from `from` to an airport in the
   * city of day 1. The outbound date defaults to the start date and the
   * return date to the last day's date. `to` may be left out when that city
   * has exactly one airport. The search itself is Yahia's (FLT-11, FLT-12).
   */
  async flights(
    id: string,
    viewer: AuthenticatedUser,
    query: ItineraryFlightQueryDto,
  ): Promise<
    FlightSearchResponseDto & {
      search: {
        from: string;
        to: string;
        tripType: 'one-way' | 'round-trip';
        departureDate: string;
        returnDate: string | null;
      };
      arrivalAirports: { code: string; name: string }[];
    }
  > {
    const { cityName, airports } = await this.arrivalAirports(id, viewer);
    const codes = airports.map((a) => a.code);
    if (codes.length === 0) {
      throw new BadRequestException(`There is no airport in ${cityName}`);
    }
    let to = query.to;
    if (!to) {
      if (codes.length > 1) {
        throw new BadRequestException(
          `Choose an arrival airport in ${cityName} (to): ${codes.join(', ')}`,
        );
      }
      to = codes[0];
    } else if (!codes.includes(to)) {
      throw new BadRequestException(
        `to must be an airport in ${cityName}: ${codes.join(', ')}`,
      );
    }

    const itinerary = await this.itineraries.loadOwned(id, viewer);
    const lastIndex = (itinerary.days?.length ?? 1) - 1;
    const tripType = query.tripType ?? 'one-way';
    const departureDate =
      query.departureDate ?? toDateOnly(itinerary.startDate!);
    const returnDate =
      tripType === 'round-trip'
        ? (query.returnDate ?? dayDate(itinerary.startDate, lastIndex)!)
        : null;

    const result = await this.airlines.searchFlights({
      departureAirportCode: query.from,
      arrivalAirportCode: to,
      departureDate,
      ...(returnDate ? { returnDate } : {}),
      tripType,
      adults: query.adults ?? 1,
      children: query.children ?? 0,
      infants: query.infants ?? 0,
      ...(query.cabinClass ? { cabinClass: query.cabinClass } : {}),
      ...(query.sort ? { sort: query.sort } : {}),
      page: query.page ?? 1,
    });

    return {
      search: { from: query.from, to, tripType, departureDate, returnDate },
      arrivalAirports: airports,
      ...result,
    };
  }
}
