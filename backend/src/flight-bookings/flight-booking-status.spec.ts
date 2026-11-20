import { BOOKING_STATUS } from '../integrations/teammate-contracts';
import {
  canTransition,
  FLIGHT_BOOKING_STATUSES,
  FlightBookingStatus,
} from './flight-booking-status';

describe('flight booking status (GEN-11)', () => {
  it('uses exactly the shared team status strings', () => {
    expect(FlightBookingStatus).toBe(BOOKING_STATUS);
    expect([...FLIGHT_BOOKING_STATUSES].sort()).toEqual([
      'Cancelled',
      'Completed',
      'Confirmed',
      'Expired',
      'Pending Payment',
    ]);
  });

  it.each([
    ['Pending Payment', 'Confirmed'],
    ['Pending Payment', 'Expired'],
    ['Confirmed', 'Completed'],
    ['Confirmed', 'Cancelled'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ['Pending Payment', 'Cancelled'],
    ['Pending Payment', 'Completed'],
    ['Confirmed', 'Expired'],
    ['Confirmed', 'Pending Payment'],
    ['Expired', 'Confirmed'],
    ['Cancelled', 'Confirmed'],
    ['Completed', 'Cancelled'],
  ] as const)('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
