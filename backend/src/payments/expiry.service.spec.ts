import { ExpiryService } from './expiry.service';
import { PaymentsService } from './payments.service';

describe('ExpiryService', () => {
  it('expires both booking types and completes both lifecycles in one run', async () => {
    const payments = {
      expirePaymentIntents: jest.fn().mockResolvedValue(['flight:flight-1']),
    };
    const flights = {
      releaseExpiredHolds: jest.fn().mockResolvedValue(2),
      completeDepartedBookings: jest.fn().mockResolvedValue(1),
    };
    const hotels = {
      releaseExpiredHolds: jest.fn().mockResolvedValue(3),
      completeEndedStays: jest.fn().mockResolvedValue(4),
    };
    const service = new ExpiryService(
      payments as unknown as PaymentsService,
      flights as any,
      hotels as any,
    );
    const now = new Date();

    await expect(service.runScheduledChecks(now)).resolves.toEqual({
      expiredFlights: 2,
      expiredHotels: 3,
      completedFlights: 1,
      completedHotels: 4,
      protectedBookings: 1,
    });
    expect(payments.expirePaymentIntents).toHaveBeenCalledWith(now);
    expect(flights.releaseExpiredHolds).toHaveBeenCalledWith(now, ['flight-1']);
    expect(hotels.releaseExpiredHolds).toHaveBeenCalledWith(now, []);
    expect(flights.completeDepartedBookings).toHaveBeenCalledWith(now);
    expect(hotels.completeEndedStays).toHaveBeenCalledWith(now);
  });
});
