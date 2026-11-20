import { hasRoomsFor } from './itinerary-search.service';

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
