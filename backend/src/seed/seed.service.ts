import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';

import { Airport } from '../reference-data/schemas/airport.schema';
import { Attraction } from '../reference-data/schemas/attraction.schema';
import { City } from '../reference-data/schemas/city.schema';
import { Country } from '../reference-data/schemas/country.schema';
import { Currency } from '../reference-data/schemas/currency.schema';
import {
  AccountStatus,
  User,
  UserRole,
} from '../users/schemas/user.schema';
import { AdminSeedConfig, readAdminSeedConfig } from './admin-seed';
import {
  DEFAULT_SEED_DATA_DIR,
  deriveCurrencies,
  loadSeedData,
} from './seed-data.loader';
import { validateSeedData } from './seed-data.validator';

export interface CollectionReport {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface SeedReport {
  countries: CollectionReport;
  currencies: CollectionReport;
  cities: CollectionReport;
  airports: CollectionReport;
  attractions: CollectionReport;
  admin: 'created' | 'unchanged';
}

/** Thrown when validation fails; every error has already been logged. */
export class SeedValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Seed validation failed with ${errors.length} error(s)`);
    this.name = 'SeedValidationError';
  }
}

/**
 * Seeds the official reference data and the administrator account
 * (GEN-12, ACC-18). Upsert-only: it never deletes, and it writes nothing
 * unless all CSV data and the admin environment variables are valid.
 */
@Injectable()
export class SeedService {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectModel(Country.name) private readonly countryModel: Model<Country>,
    @InjectModel(Currency.name)
    private readonly currencyModel: Model<Currency>,
    @InjectModel(City.name) private readonly cityModel: Model<City>,
    @InjectModel(Airport.name) private readonly airportModel: Model<Airport>,
    @InjectModel(Attraction.name)
    private readonly attractionModel: Model<Attraction>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async run(dataDir: string = DEFAULT_SEED_DATA_DIR): Promise<SeedReport> {
    // 1. Load and validate everything before any database call.
    const data = loadSeedData(dataDir);
    const currencies = deriveCurrencies(data.countries);
    const admin = readAdminSeedConfig(process.env);
    const errors = [...validateSeedData(data), ...admin.errors];

    if (errors.length > 0 || !admin.config) {
      for (const error of errors) this.logger.error(error);
      throw new SeedValidationError(errors);
    }

    // 2. Write in dependency order, one bulkWrite per collection.
    const countries = await this.upsert(
      this.countryModel,
      data.countries.map(({ id, name, currency }) => ({
        _id: id,
        fields: { name, currency },
      })),
    );
    const currencyReport = await this.upsert(
      this.currencyModel,
      currencies.map(({ id, countryCodes }) => ({
        _id: id,
        fields: { countryCodes },
      })),
    );
    const cities = await this.upsert(
      this.cityModel,
      data.cities.map(({ id, name, countryCode }) => ({
        _id: id,
        fields: { name, countryCode },
      })),
    );
    const airports = await this.upsert(
      this.airportModel,
      data.airports.map(({ id, name, cityId, countryCode, timeZone }) => ({
        _id: id,
        fields: { name, cityId, countryCode, timeZone },
      })),
    );
    const attractions = await this.upsert(
      this.attractionModel,
      data.attractions.map(({ id, name, cityId }) => ({
        _id: id,
        fields: { name, cityId },
      })),
    );

    // 3. Admin account (after reference data; those writes are idempotent).
    const adminStatus = await this.seedAdmin(admin.config);

    return {
      countries,
      currencies: currencyReport,
      cities,
      airports,
      attractions,
      admin: adminStatus,
    };
  }

  // Typed loosely: the reference models differ, but all use a string _id.
  private async upsert(
    model: Model<any>,
    docs: { _id: string; fields: Record<string, unknown> }[],
  ): Promise<CollectionReport> {
    const now = new Date();
    const operations = docs.map(({ _id, fields }) => ({
      updateOne: {
        filter: { _id },
        // Timestamps are set only on insert, so re-running the seed with
        // unchanged data reports 0 updated instead of touching updatedAt.
        update: {
          $set: fields,
          $setOnInsert: { createdAt: now, updatedAt: now },
        },
        upsert: true,
      },
    }));

    const result = await model.bulkWrite(operations, {
      ordered: true,
      timestamps: false,
    });

    return {
      inserted: result.upsertedCount,
      updated: result.modifiedCount,
      unchanged: result.matchedCount - result.modifiedCount,
    };
  }

  private async seedAdmin(
    config: AdminSeedConfig,
  ): Promise<SeedReport['admin']> {
    const existing = await this.userModel
      .findOne({ email: config.email })
      .lean()
      .exec();

    if (existing) {
      if (existing.role !== UserRole.ADMIN) {
        throw new Error(
          'SEED_ADMIN_EMAIL belongs to an existing non-admin account; refusing to promote it',
        );
      }
      this.logger.log('admin already exists (unchanged)');
      return 'unchanged';
    }

    const now = new Date();
    await this.userModel.create({
      name: config.name,
      email: config.email,
      passwordHash: await bcrypt.hash(config.password, 12),
      role: UserRole.ADMIN,
      status: AccountStatus.ACTIVE,
      termsAcceptedAt: now,
      privacyPolicyAcceptedAt: now,
      mustChangePassword: false,
    });
    return 'created';
  }
}
