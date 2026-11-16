import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { AirlinesService } from './airlines.service';
import { CreateAirlineDto, UpdateAirlineDto } from './dto/airline.dto';
import { CabinCategory, FlightStatus } from './schemas/flight.schema';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });
const leanExec = (value: unknown) => ({ lean: () => exec(value) });

describe('AirlinesService', () => {
  let model: Record<string, jest.Mock>;
  let flightModel: Record<string, jest.Mock>;
  let referenceData: { listAirports: jest.Mock };
  let assignments: { findByModeratorId: jest.Mock };
  let service: AirlinesService;

  const id = new Types.ObjectId();
  const stored = {
    _id: id,
    name: 'Cairo Air',
    code: 'CA',
    logoUrl: null,
    isActive: true,
    createdAt: new Date('2026-11-10T10:00:00.000Z'),
    updatedAt: new Date('2026-11-10T10:00:00.000Z'),
  };

  beforeEach(() => {
    model = {
      create: jest.fn().mockResolvedValue(stored),
      findById: jest.fn().mockReturnValue(leanExec(stored)),
      findByIdAndUpdate: jest.fn().mockReturnValue(leanExec(stored)),
    };
    flightModel = {
      create: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        airlineId: id,
        flightNumber: 'CA101',
        departureAirportCode: 'CAI',
        arrivalAirportCode: 'DXB',
        departureAt: new Date('2027-01-01T08:30:00.000Z'),
        arrivalAt: new Date('2027-01-01T10:00:00.000Z'),
        departureTimeZone: 'Africa/Cairo',
        arrivalTimeZone: 'Asia/Dubai',
        departureLocalDate: '2027-01-01',
      }),
      findById: jest.fn().mockReturnValue({
        exec: () =>
          Promise.resolve({
            airlineId: id,
            cabins: [],
            save: jest.fn().mockResolvedValue(undefined),
          }),
      }),
    };
    referenceData = {
      findAirport: jest.fn().mockImplementation((code: string) =>
        Promise.resolve(
          code === 'CAI'
            ? {
                _id: 'CAI',
                name: 'Cairo International Airport',
                cityId: 'cairo',
                countryCode: 'EG',
                timeZone: 'Africa/Cairo',
              }
            : {
                _id: 'DXB',
                name: 'Dubai International Airport',
                cityId: 'dubai',
                countryCode: 'AE',
                timeZone: 'Asia/Dubai',
              },
        ),
      ),
      listAirports: jest.fn().mockResolvedValue({
        items: [
          {
            _id: 'CAI',
            name: 'Cairo International Airport',
            cityId: 'cairo',
            countryCode: 'EG',
            timeZone: 'Africa/Cairo',
          },
        ],
      }),
    };
    assignments = {
      findByModeratorId: jest.fn().mockResolvedValue({
        providerType: 'airline',
        providerId: id.toString(),
      }),
    };
    service = new AirlinesService(
      model as never,
      flightModel as never,
      null,
      referenceData as never,
      assignments as never,
    );
  });

  it('creates an active airline with a null logo (logos are uploaded separately)', async () => {
    const dto: CreateAirlineDto = { name: 'Cairo Air', code: 'CA' };

    await expect(service.create(dto)).resolves.toMatchObject({
      id: id.toString(),
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      logoUrl: null,
    });
    expect(model.create).toHaveBeenCalledWith({
      name: 'Cairo Air',
      code: 'CA',
      isActive: true,
      logoUrl: null,
    });
  });

  it('maps a stored airline profile', async () => {
    await expect(service.findOne(id.toString())).resolves.toMatchObject({
      id: id.toString(),
      name: 'Cairo Air',
      code: 'CA',
    });
  });

  it('updates only profile fields and never changes isActive', async () => {
    const dto: UpdateAirlineDto = { name: 'Cairo Airways', code: 'CW' };

    await service.update(id.toString(), dto);

    expect(model.findByIdAndUpdate).toHaveBeenCalledWith(
      id.toString(),
      { name: 'Cairo Airways', code: 'CW' },
      { returnDocument: 'after', runValidators: true },
    );
  });

  it('rejects duplicate airline codes', async () => {
    model.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.create({ name: 'Cairo Air', code: 'CA' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // Was 501 before the upload module existed (Person 8). A direct URL is now
  // a 400: logos are only set by uploading a file.
  it('does not accept a direct logo URL', async () => {
    await expect(
      service.create({
        name: 'Cairo Air',
        code: 'CA',
        logoUrl: 'https://example.com/logo.png',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(id.toString(), { logoUrl: 'https://example.com/logo.png' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.create).not.toHaveBeenCalled();
    expect(model.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  describe('logo upload (FLT-01, GEN-08)', () => {
    let store: { upload: jest.Mock; remove: jest.Mock };
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]) };
    const withStore = () =>
      new AirlinesService(
        model as never,
        flightModel as never,
        store as never,
        referenceData as never,
        assignments as never,
      );

    beforeEach(() => {
      store = {
        upload: jest.fn().mockResolvedValue('/api/uploads/new.jpg'),
        remove: jest.fn().mockResolvedValue(undefined),
      };
      model.exists = jest.fn().mockReturnValue(exec({ _id: id }));
      model.findByIdAndUpdate = jest
        .fn()
        .mockReturnValue(leanExec({ ...stored, logoUrl: '/api/uploads/old.jpg' }));
      model.findById = jest
        .fn()
        .mockReturnValue(leanExec({ ...stored, logoUrl: '/api/uploads/new.jpg' }));
    });

    it('answers 501 while no upload store is bound', async () => {
      await expect(service.uploadLogo(id.toString(), file)).rejects.toBeInstanceOf(
        NotImplementedException,
      );
    });

    it('replaces the logo and deletes the old file (1 logo per airline)', async () => {
      const result = await withStore().uploadLogo(id.toString(), file);

      expect(store.upload).toHaveBeenCalledWith(file, id.toString());
      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(id.toString(), {
        $set: { logoUrl: '/api/uploads/new.jpg' },
      });
      expect(store.remove).toHaveBeenCalledWith('/api/uploads/old.jpg');
      expect(result.logoUrl).toBe('/api/uploads/new.jpg');
    });

    it('stores nothing for an unknown airline', async () => {
      model.exists.mockReturnValue(exec(null));
      await expect(
        withStore().uploadLogo(id.toString(), file),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(store.upload).not.toHaveBeenCalled();
    });

    it('deletes the new file if the airline disappears during the upload', async () => {
      model.findByIdAndUpdate.mockReturnValue(leanExec(null));
      await expect(
        withStore().uploadLogo(id.toString(), file),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(store.remove).toHaveBeenCalledWith('/api/uploads/new.jpg');
    });

    it('removes the logo and its file', async () => {
      model.findById.mockReturnValue(leanExec({ ...stored, logoUrl: null }));
      const result = await withStore().removeLogo(id.toString());

      expect(model.findByIdAndUpdate).toHaveBeenCalledWith(id.toString(), {
        $set: { logoUrl: null },
      });
      expect(store.remove).toHaveBeenCalledWith('/api/uploads/old.jpg');
      expect(result.logoUrl).toBeNull();
    });
  });

  it('maps seeded airports to the public airport contract', async () => {
    await expect(service.listAirports()).resolves.toEqual([
      {
        iataCode: 'CAI',
        name: 'Cairo International Airport',
        city: 'cairo',
        country: 'EG',
        timeZone: 'Africa/Cairo',
      },
    ]);
  });

  it('converts airport-local date-times to UTC and stores both zones', async () => {
    const result = await service.createFlight('moderator-id', {
      airlineId: id.toString(),
      flightNumber: 'CA101',
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'DXB',
      departureLocalTime: '2027-01-01T10:30:00',
      arrivalLocalTime: '2027-01-01T14:00:00',
    });

    expect(result.departureAt).toEqual(new Date('2027-01-01T08:30:00.000Z'));
    expect(result.arrivalAt).toEqual(new Date('2027-01-01T10:00:00.000Z'));
    expect(result.departureTimeZone).toBe('Africa/Cairo');
    expect(result.arrivalTimeZone).toBe('Asia/Dubai');
  });

  it('adds one cabin category to an owned flight', async () => {
    const result = await service.addCabin('moderator-id', id.toString(), {
      category: CabinCategory.ECONOMY,
      seatCount: 120,
      price: 250,
      freeBaggageAllowance: 1,
      maxWeightPerBagKg: 23,
    });

    expect(result).toMatchObject({
      category: CabinCategory.ECONOMY,
      seatCount: 120,
      price: 250,
    });
  });

  it('updates the airline extra-baggage policy', async () => {
    await expect(
      service.updateBaggagePolicy(id.toString(), {
        pricePerExtraBag: 35,
        maxExtraBagsPerPassenger: 2,
      }),
    ).resolves.toEqual({
      pricePerExtraBag: 35,
      maxExtraBagsPerPassenger: 2,
    });
  });

  it('sorts and stores unique cancellation tiers', async () => {
    await expect(
      service.updateCancellationPolicy(id.toString(), {
        tiers: [
          { daysBeforeDeparture: 0, refundPercentage: 0 },
          { daysBeforeDeparture: 30, refundPercentage: 75 },
        ],
      }),
    ).resolves.toEqual({
      tiers: [
        { daysBeforeDeparture: 30, refundPercentage: 75 },
        { daysBeforeDeparture: 0, refundPercentage: 0 },
      ],
    });
  });

  it('derives scheduled, departed and cancelled flight status', async () => {
      flightModel.findById.mockReturnValue(
        leanExec({
          status: FlightStatus.SCHEDULED,
          departureAt: new Date('2026-11-11T10:00:00.000Z'),
        }),
      );
      await expect(
        service.getFlightStatus(
          id.toString(),
          new Date('2026-11-10T10:00:00.000Z'),
        ),
      ).resolves.toEqual({ status: FlightStatus.SCHEDULED });

      flightModel.findById.mockReturnValue(
        leanExec({
          status: FlightStatus.SCHEDULED,
          departureAt: new Date('2026-11-09T10:00:00.000Z'),
        }),
      );
      await expect(
        service.getFlightStatus(
          id.toString(),
          new Date('2026-11-10T10:00:00.000Z'),
        ),
      ).resolves.toEqual({ status: FlightStatus.DEPARTED });

    flightModel.findById.mockReturnValue(
      leanExec({
        status: FlightStatus.CANCELLED,
        departureAt: new Date('2026-11-09T10:00:00.000Z'),
      }),
    );
    await expect(
      service.getFlightStatus(
        id.toString(),
        new Date('2026-11-10T10:00:00.000Z'),
      ),
    ).resolves.toEqual({ status: FlightStatus.CANCELLED });
  });

  it('rejects reducing cabin seats below booked and held seats', async () => {
    const cabinId = new Types.ObjectId();
    flightModel.findById.mockReturnValue({
      exec: () =>
        Promise.resolve({
          airlineId: id,
          status: 'Scheduled',
          cabins: [
            {
              _id: cabinId,
              category: CabinCategory.ECONOMY,
              seatCount: 10,
              seatsBooked: 4,
              seatsHeld: 2,
              save: jest.fn(),
            },
          ],
          save: jest.fn(),
        }),
    });

    await expect(
      service.updateCabin('moderator-id', id.toString(), cabinId.toString(), {
        seatCount: 5,
      }),
    ).rejects.toThrow('Seat count cannot be below booked and held seats');
  });

  it('requires explicit cancellation confirmation', async () => {
    await expect(
      service.cancelFlight('moderator-id', id.toString(), false),
    ).rejects.toThrow('Cancellation must be explicitly confirmed');
  });
});
