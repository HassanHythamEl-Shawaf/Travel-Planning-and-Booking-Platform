import { Types } from 'mongoose';

import { hasRoomsFor } from './itinerary-search.service';
import { ItinerarySearchService } from './itinerary-search.service';
import type { ItineraryFlightQueryDto, ItineraryHotelQueryDto } from './dto/itinerary-search.dto';

const room = (maxAdults: number, maxChildren = 0) => ({
  _id: 'r',
  name: 'Room',
  pricePerNight: 100,
  occupancy: { maxAdults, maxChildren },
});

describe('hasRoomsFor (ITN-25, HTL-11 rule)', () => {
  it('needs at least N free rooms', () => {
    expect(hasRoomsFor([room(4)], 2, 2)).toBe(false);
    expect(hasRoomsFor([room(1), room(1)], 2, 2)).toBe(true);
  });

  describe('ItinerarySearchService pagination', () => {
    const itinerary = {
      startDate: new Date('2099-12-20T00:00:00Z'),
      days: [{ _id: new Types.ObjectId(), cityId: 'luxor' }],
    };
    const viewer = { sub: 'user-1' } as never;

    it('reads hotel search results beyond page 20', async () => {
      const hotels = {
        searchHotels: jest.fn().mockImplementation(({ page }: { page: number }) =>
          Promise.resolve({
            data: [],
            total: 0,
            page,
            limit: 10,
            totalPages: 21,
          }),
        ),
      };
      const service = new ItinerarySearchService(
        { loadOwned: jest.fn().mockResolvedValue(itinerary) } as never,
        hotels as never,
        {} as never,
        { findCity: jest.fn().mockResolvedValue({ name: 'Luxor' }) } as never,
      );

      await service.hotelsForGroup('itinerary-1', viewer, {
        group: 1,
        guests: 1,
      } as ItineraryHotelQueryDto);

      expect(hotels.searchHotels).toHaveBeenCalledTimes(21);
      expect(hotels.searchHotels).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 21 }),
      );
    });

    it('reads flight search results beyond page 20', async () => {
      const airlines = {
        searchFlights: jest.fn().mockImplementation(({ page }: { page: number }) =>
          Promise.resolve({
            items: [],
            returnItems: [],
            page,
            limit: 10,
            totalPages: 21,
          }),
        ),
      };
      const service = new ItinerarySearchService(
        { loadOwned: jest.fn().mockResolvedValue(itinerary) } as never,
        {} as never,
        airlines as never,
        {
          findCity: jest.fn().mockResolvedValue({ name: 'Luxor' }),
          getAirportsInCity: jest.fn().mockResolvedValue([
            { _id: 'LXR', name: 'Luxor Airport' },
          ]),
        } as never,
      );

      await service.flights('itinerary-1', viewer, {
        from: 'CAI',
      } as ItineraryFlightQueryDto);

      expect(airlines.searchFlights).toHaveBeenCalledTimes(21);
      expect(airlines.searchFlights).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 21 }),
      );
    });
  });

  it('checks the combined maximum occupancy of the N biggest rooms', () => {
    const rooms = [room(1), room(2, 1), room(2)];
    expect(hasRoomsFor(rooms, 2, 5)).toBe(true); // 3 + 2
    expect(hasRoomsFor(rooms, 2, 6)).toBe(false);
    expect(hasRoomsFor(rooms, 1, 3)).toBe(true);
    expect(hasRoomsFor(rooms, 1, 4)).toBe(false);
  });

  it('treats missing occupancy as 0', () => {
    expect(hasRoomsFor([{ _id: 'r', name: 'x', pricePerNight: 1 }], 1, 1)).toBe(
      false,
    );
  });
});
