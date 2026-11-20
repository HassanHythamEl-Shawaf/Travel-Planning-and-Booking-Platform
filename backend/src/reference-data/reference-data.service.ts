import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';

import { getPagination, Paginated } from '../common/pagination';
import { Airport } from './schemas/airport.schema';
import { Attraction } from './schemas/attraction.schema';
import { City } from './schemas/city.schema';
import { Country } from './schemas/country.schema';
import { Currency } from './schemas/currency.schema';

type PageValue = string | number | undefined;

export interface CountryListQuery {
  page?: PageValue;
  search?: string;
}

export interface CityListQuery {
  page?: PageValue;
  countryCode?: string;
  search?: string;
}

export interface AirportListQuery {
  page?: PageValue;
  cityId?: string;
  countryCode?: string;
  search?: string;
}

export interface AttractionListQuery {
  page?: PageValue;
  cityId?: string;
}

export interface CurrencyListQuery {
  page?: PageValue;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function searchRegex(search: string): RegExp {
  return new RegExp(escapeRegex(search), 'i');
}

/**
 * Read access to the seeded reference data (GEN-12). IDs are the official
 * dataset identifiers and are matched exactly as given (no case changes).
 */
@Injectable()
export class ReferenceDataService {
  constructor(
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractionModel: Model<Attraction>,
    @InjectModel(Currency.name)
    private readonly currencyModel: Model<Currency>,
  ) {}

  findCountry(code: string): Promise<Country | null> {
    return this.countryModel.findById(code).lean<Country>().exec();
  }

  findCity(cityId: string): Promise<City | null> {
    return this.cityModel.findById(cityId).lean<City>().exec();
  }

  findAirport(iataCode: string): Promise<Airport | null> {
    return this.airportModel.findById(iataCode).lean<Airport>().exec();
  }

  findAttraction(id: string): Promise<Attraction | null> {
    return this.attractionModel.findById(id).lean<Attraction>().exec();
  }

  async countryExists(code: string): Promise<boolean> {
    return (await this.countryModel.exists({ _id: code })) !== null;
  }

  async cityExists(cityId: string): Promise<boolean> {
    return (await this.cityModel.exists({ _id: cityId })) !== null;
  }

  async airportExists(iataCode: string): Promise<boolean> {
    return (await this.airportModel.exists({ _id: iataCode })) !== null;
  }

  async isSupportedCurrency(code: string): Promise<boolean> {
    return (await this.currencyModel.exists({ _id: code })) !== null;
  }

  listCountries(query: CountryListQuery = {}): Promise<Paginated<Country>> {
    const filter: QueryFilter<Country> = {};
    if (query.search) {
      const regex = searchRegex(query.search);
      filter.$or = [{ name: regex }, { _id: regex }];
    }
    return this.paginate(this.countryModel, filter, { name: 1 }, query.page);
  }

  listCities(query: CityListQuery = {}): Promise<Paginated<City>> {
    const filter: QueryFilter<City> = {};
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.search) filter.name = searchRegex(query.search);
    return this.paginate(this.cityModel, filter, { name: 1 }, query.page);
  }

  listAirports(query: AirportListQuery = {}): Promise<Paginated<Airport>> {
    const filter: QueryFilter<Airport> = {};
    if (query.cityId) filter.cityId = query.cityId;
    if (query.countryCode) filter.countryCode = query.countryCode;
    if (query.search) {
      const regex = searchRegex(query.search);
      filter.$or = [{ name: regex }, { _id: regex }];
    }
    return this.paginate(this.airportModel, filter, { name: 1 }, query.page);
  }

  listAttractions(
    query: AttractionListQuery = {},
  ): Promise<Paginated<Attraction>> {
    const filter: QueryFilter<Attraction> = {};
    if (query.cityId) filter.cityId = query.cityId;
    return this.paginate(this.attractionModel, filter, { name: 1 }, query.page);
  }

  listCurrencies(query: CurrencyListQuery = {}): Promise<Paginated<Currency>> {
    return this.paginate(this.currencyModel, {}, { _id: 1 }, query.page);
  }

  // ITN-26: airports in the itinerary's first-day city
  getAirportsInCity(cityId: string): Promise<Airport[]> {
    return this.airportModel
      .find({ cityId })
      .sort({ name: 1 })
      .lean<Airport[]>()
      .exec();
  }

  async getCurrencyCodes(): Promise<string[]> {
    const currencies = await this.currencyModel
      .find({}, { _id: 1 })
      .sort({ _id: 1 })
      .lean<Pick<Currency, '_id'>[]>()
      .exec();
    return currencies.map((currency) => currency._id);
  }

  private async paginate<T>(
    model: Model<T>,
    filter: QueryFilter<T>,
    sort: Record<string, 1 | -1>,
    pageValue: PageValue,
  ): Promise<Paginated<T>> {
    const { page, limit, skip } = getPagination(pageValue ?? 1);
    const [items, total] = await Promise.all([
      model.find(filter).sort(sort).skip(skip).limit(limit).lean<T[]>().exec(),
      model.countDocuments(filter).exec(),
    ]);
    return {
      items,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }
}
