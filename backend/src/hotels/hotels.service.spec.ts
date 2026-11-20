import { HotelsService } from './hotels.service';
import { Types } from 'mongoose';

describe('HotelsService.checkAvailability', () => {
  const checkIn = '2099-12-20';
  const checkOut = '2099-12-23';
  const room = { _id: 'room-1', hotelId: 'hotel-1', isActive: true };
  const hotel = { _id: 'hotel-1', isActive: true };

  function build(availabilityWindow: { startDate: Date; endDate: Date }) {
    const hotelModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(hotel) }),
    };
    const roomModel = {
      findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(room) }),
    };
    const roomAvailabilityModel = {
      find: jest.fn().mockImplementation((filter: Record<string, unknown>) => {
        const exec = jest.fn().mockResolvedValue(
          filter.status === 'available' ? [availabilityWindow] : [],
        );
        return {
          select: () => ({ lean: () => ({ exec }) }),
          lean: () => ({ exec }),
        };
      }),
    };
    return new HotelsService(
      {} as never,
      hotelModel as never,
      roomModel as never,
      roomAvailabilityModel as never,
      {} as never,
    );
  }

  it('requires explicit availability windows to cover the full stay', async () => {
    const service = build({
      startDate: new Date('2099-12-10T00:00:00Z'),
      endDate: new Date('2099-12-15T00:00:00Z'),
    });

    await expect(
      service.checkAvailability('room-1', checkIn, checkOut),
    ).resolves.toBe(false);
  });

  it('accepts a window that fully covers the requested stay', async () => {
    const service = build({
      startDate: new Date('2099-12-19T00:00:00Z'),
      endDate: new Date('2099-12-25T00:00:00Z'),
    });

    await expect(
      service.checkAvailability('room-1', checkIn, checkOut),
    ).resolves.toBe(true);
  });
});

describe('HotelsService room ownership queries', () => {
  const hotelId = '507f1f77bcf86cd799439011';
  const roomId = '507f1f77bcf86cd799439012';

  it('uses ObjectIds when listing rooms for a hotel', async () => {
    const hotelModel = {
      findById: jest.fn().mockReturnValue({
        lean: () => ({
          exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(hotelId), isActive: true }),
        }),
      }),
    };
    const roomModel = {
      find: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      }),
    };
    const service = new HotelsService(
      {} as never,
      hotelModel as never,
      roomModel as never,
      {} as never,
      {} as never,
    );

    await service.findRoomsByHotel(hotelId);

    expect(roomModel.find).toHaveBeenCalledWith({
      hotelId: new Types.ObjectId(hotelId),
      isActive: { $ne: false },
    });
  });

  it('uses ObjectIds when checking room ownership', async () => {
    const roomModel = {
      exists: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(roomId) }),
    };
    const service = new HotelsService(
      {} as never,
      {} as never,
      roomModel as never,
      {} as never,
      {} as never,
    );

    await expect(service.roomBelongsToHotel(hotelId, roomId)).resolves.toBe(true);

    expect(roomModel.exists).toHaveBeenCalledWith({
      _id: new Types.ObjectId(roomId),
      hotelId: new Types.ObjectId(hotelId),
    });
  });
});
