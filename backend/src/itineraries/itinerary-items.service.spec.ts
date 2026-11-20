import { BadRequestException, ConflictException } from '@nestjs/common';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { City, CitySchema } from '../reference-data/schemas/city.schema';
import {
  Country,
  CountrySchema,
} from '../reference-data/schemas/country.schema';
import {
  Currency,
  CurrencySchema,
} from '../reference-data/schemas/currency.schema';
import { Report, ReportSchema } from '../reports/schemas/report.schema';
import { User, UserRole, UserSchema } from '../users/schemas/user.schema';
import { ItineraryItemsService } from './itinerary-items.service';
import { ItinerariesService } from './itineraries.service';
import { MAX_DAYS, MAX_SAVE_ATTEMPTS } from './itineraries.constants';
import { PublicItinerariesService } from './public-itineraries.service';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';

jest.setTimeout(120_000);

/**
 * The itinerary services against a real (in-memory) MongoDB. The upload
 * module is replaced by a small fake that records what happens to files.
 */
describe('Itinerary services on MongoDB', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let itineraryModel: Model<Itinerary>;
  let userModel: Model<User>;
  let uploads: {
    upload: jest.Mock;
    copy: jest.Mock;
    delete: jest.Mock;
  };
  let itineraries: ItinerariesService;
  let items: ItineraryItemsService;
  let publicItineraries: PublicItinerariesService;

  const ownerId = new Types.ObjectId();
  const owner = { sub: ownerId.toString(), role: UserRole.USER };
  const readerId = new Types.ObjectId();
  const reader = { sub: readerId.toString(), role: UserRole.USER };

  const newTrip = () =>
    itineraries.create(owner, {
      title: 'Egypt',
      countries: ['EG'],
      startDate: '2026-12-30',
    });

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'itineraries' })
      .asPromise();
    itineraryModel = connection.model(
      Itinerary.name,
      ItinerarySchema,
    ) as unknown as Model<Itinerary>;
    userModel = connection.model(
      User.name,
      UserSchema,
    ) as unknown as Model<User>;
    const cityModel = connection.model(
      City.name,
      CitySchema,
    ) as unknown as Model<City>;
    const countryModel = connection.model(
      Country.name,
      CountrySchema,
    ) as unknown as Model<Country>;
    const currencyModel = connection.model(
      Currency.name,
      CurrencySchema,
    ) as unknown as Model<Currency>;
    const reportModel = connection.model(
      Report.name,
      ReportSchema,
    ) as unknown as Model<Report>;

    await countryModel.create({ _id: 'EG', name: 'Egypt', currency: 'EGP' });
    await cityModel.create([
      { _id: 'cairo', name: 'Cairo', countryCode: 'EG' },
      { _id: 'luxor', name: 'Luxor', countryCode: 'EG' },
    ]);
    await currencyModel.create({ _id: 'EGP', countryCodes: ['EG'] });
    await userModel.collection.insertMany([
      {
        _id: ownerId,
        name: 'Alice',
        email: 'alice@t.test',
        status: 'active',
        role: 'user',
      },
      {
        _id: readerId,
        name: 'Bob',
        email: 'bob@t.test',
        status: 'active',
        role: 'user',
      },
    ]);

    uploads = {
      upload: jest.fn(),
      copy: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    itineraries = new ItinerariesService(
      itineraryModel,
      userModel,
      cityModel,
      countryModel,
      currencyModel,
      reportModel,
      connection,
      uploads as never,
    );
    items = new ItineraryItemsService(itineraries, uploads as never);
    publicItineraries = new PublicItinerariesService(
      itineraries,
      uploads as never,
      cityModel,
      countryModel,
    );
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    uploads.upload.mockReset();
    uploads.copy.mockReset();
    uploads.delete.mockClear();
    await itineraryModel.deleteMany({});
  });

  describe('days (ITN-05, ITN-07, ITN-08)', () => {
    it('adds, moves and deletes days; transport entries stay on their day', async () => {
      const { id } = await newTrip();
      await items.addDay(id, owner, { cityId: 'cairo' });
      await items.addDay(id, owner, { cityId: 'cairo' });
      let view = await items.addDay(id, owner, { cityId: 'luxor' });
      const luxorId = view.days[2].id;
      view = await items.addTransportEntry(id, owner, {
        dayId: luxorId,
        mode: 'train',
        fromCityId: 'cairo',
        toCityId: 'luxor',
        amount: 900,
        currency: 'EGP',
      });
      expect(view.transportEntries[0].dayNumber).toBe(3);

      view = await items.moveDay(id, luxorId, owner, { position: 1 });
      expect(view.days.map((d) => d.cityId)).toEqual([
        'luxor',
        'cairo',
        'cairo',
      ]);
      expect(view.transportEntries[0].dayNumber).toBe(1);
      expect(view.cityGroups.map((g) => g.dayCount)).toEqual([1, 2]);

      view = await items.removeDay(id, view.days[1].id, owner);
      expect(view.days.map((d) => [d.dayNumber, d.date])).toEqual([
        [1, '2026-12-30'],
        [2, '2026-12-31'],
      ]);
      // Deleting the Luxor day removes its transport entry too.
      view = await items.removeDay(id, luxorId, owner);
      expect(view.transportEntries).toEqual([]);
      expect(view.budget.total.amounts).toEqual([]);
    });

    it(`refuses more than ${MAX_DAYS} days`, async () => {
      const { id } = await newTrip();
      await itineraryModel.updateOne(
        { _id: id },
        {
          $set: {
            days: Array.from({ length: MAX_DAYS }, () => ({
              _id: new Types.ObjectId(),
              cityId: 'cairo',
            })),
          },
        },
      );
      await expect(
        items.addDay(id, owner, { cityId: 'luxor' }),
      ).rejects.toThrow(`An itinerary can have at most ${MAX_DAYS} days`);
    });

    it('rejects cities that are not in the city list', async () => {
      const { id } = await newTrip();
      await expect(
        items.addDay(id, owner, { cityId: 'atlantis' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('save: parallel edits (spec D9)', () => {
    it('retries when someone else saved in between, and keeps both changes', async () => {
      const { id } = await newTrip();
      await items.addDay(id, owner, { cityId: 'cairo' });

      // Simulate another request saving between our read and our write.
      const realUpdate = itineraryModel.updateOne.bind(itineraryModel);
      let first = true;
      jest.spyOn(itineraryModel, 'updateOne').mockImplementation(((
        ...args: never[]
      ) => {
        if (first) {
          first = false;
          return {
            exec: async () => {
              await realUpdate(
                { _id: id },
                {
                  $push: {
                    days: { _id: new Types.ObjectId(), cityId: 'luxor' },
                  },
                  $inc: { version: 1 },
                },
              ).exec();
              return realUpdate(...args).exec();
            },
          };
        }
        return realUpdate(...args);
      }) as never);

      const view = await items.addDay(id, owner, {
        cityId: 'cairo',
        notes: 'mine',
      });
      expect(view.days.map((d) => d.cityId)).toEqual([
        'cairo',
        'luxor',
        'cairo',
      ]);
      expect(view.days[2].notes).toBe('mine');
    });

    it(`answers 409 after ${MAX_SAVE_ATTEMPTS} failed attempts`, async () => {
      const { id } = await newTrip();
      jest
        .spyOn(itineraryModel, 'updateOne')
        .mockReturnValue({ exec: async () => ({ matchedCount: 0 }) } as never);
      await expect(
        items.addDay(id, owner, { cityId: 'cairo' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(itineraryModel.updateOne).toHaveBeenCalledTimes(MAX_SAVE_ATTEMPTS);
    });

    it('never overwrites a hide or visibility change made at the same time', async () => {
      const { id } = await newTrip();
      await itineraryModel.updateOne(
        { _id: id },
        { $set: { isHidden: true, isPublic: true } },
      );
      await items.addDay(id, owner, { cityId: 'cairo' });
      const stored = await itineraryModel.findById(id).lean();
      expect(stored).toMatchObject({ isHidden: true, isPublic: true });
    });
  });

  describe('activity images (ITN-12)', () => {
    it('deletes the stored file when it cannot be attached', async () => {
      const { id } = await newTrip();
      let view = await items.addDay(id, owner, { cityId: 'cairo' });
      view = await items.addActivity(id, view.days[0].id, owner, {
        name: 'Museum',
      });
      const dayId = view.days[0].id;
      const activityId = view.days[0].activities[0].id;
      uploads.upload.mockResolvedValue({
        id: 'up-1',
        url: '/api/uploads/x.jpg',
      });

      // The activity is deleted while the file is being stored.
      uploads.upload.mockImplementationOnce(async () => {
        await items.removeActivity(id, dayId, activityId, owner);
        return { id: 'up-1', url: '/api/uploads/x.jpg' };
      });
      await expect(
        items.addActivityImage(id, dayId, activityId, owner, {}),
      ).rejects.toThrow('Activity not found');
      expect(uploads.delete).toHaveBeenCalledWith('up-1');
    });

    it('deletes image files when their day is deleted', async () => {
      const { id } = await newTrip();
      let view = await items.addDay(id, owner, { cityId: 'cairo' });
      view = await items.addActivity(id, view.days[0].id, owner, {
        name: 'Museum',
      });
      uploads.upload.mockResolvedValue({
        id: 'up-2',
        url: '/api/uploads/y.jpg',
      });
      view = await items.addActivityImage(
        id,
        view.days[0].id,
        view.days[0].activities[0].id,
        owner,
        {},
      );
      await items.removeDay(id, view.days[0].id, owner);
      expect(uploads.delete).toHaveBeenCalledWith('up-2');
    });
  });

  describe('clone (ITN-21)', () => {
    it('is private, credits the author, copies images and is independent', async () => {
      const { id } = await newTrip();
      let view = await items.addDay(id, owner, { cityId: 'cairo' });
      view = await items.addActivity(id, view.days[0].id, owner, {
        name: 'Museum',
        cost: 10,
        currency: 'EGP',
      });
      uploads.upload.mockResolvedValue({
        id: 'orig-img',
        url: '/api/uploads/o.jpg',
      });
      view = await items.addActivityImage(
        id,
        view.days[0].id,
        view.days[0].activities[0].id,
        owner,
        {},
      );
      await itineraries.setVisibility(id, owner, { isPublic: true });
      uploads.copy.mockResolvedValue({
        id: 'copy-img',
        url: '/api/uploads/c.jpg',
      });

      const clone = await publicItineraries.clone(id, reader);
      expect(clone).toMatchObject({
        isPublic: false,
        isOwner: true,
        author: { name: 'Bob' },
        clonedFrom: {
          itineraryId: id,
          author: { id: ownerId.toString(), name: 'Alice' },
        },
      });
      expect(clone.days[0].activities[0].images).toEqual([
        { imageId: 'copy-img', url: '/api/uploads/c.jpg' },
      ]);
      expect(uploads.copy).toHaveBeenCalledWith(
        'orig-img',
        { type: 'activity', id: clone.days[0].activities[0].id },
        reader.sub,
      );

      // Editing the clone does not touch the original.
      await items.updateDay(clone.id, clone.days[0].id, reader, {
        notes: 'changed',
      });
      const original = await itineraries.findOne(id, owner);
      expect(original.days[0].notes).toBe('');
    });

    it('removes copied files if the clone cannot be saved', async () => {
      const { id } = await newTrip();
      let view = await items.addDay(id, owner, { cityId: 'cairo' });
      view = await items.addActivity(id, view.days[0].id, owner, {
        name: 'Museum',
      });
      uploads.upload.mockResolvedValue({
        id: 'orig',
        url: '/api/uploads/o.jpg',
      });
      await items.addActivityImage(
        id,
        view.days[0].id,
        view.days[0].activities[0].id,
        owner,
        {},
      );
      uploads.copy.mockResolvedValue({ id: 'copy', url: '/api/uploads/c.jpg' });
      jest
        .spyOn(itineraryModel, 'create')
        .mockRejectedValueOnce(new Error('db down') as never);

      await expect(publicItineraries.clone(id, owner)).rejects.toThrow(
        'db down',
      );
      expect(uploads.delete).toHaveBeenCalledWith('copy');
    });
  });
});
