import { ExpiryService } from './expiry.service';

describe('ExpiryService', () => {
  it('calls the shared booking lifecycle release and completion helpers', async () => {
    const bookingPayments = {
      getForPayment: jest.fn(),
      confirmBooking: jest.fn(),
      releaseHold: jest.fn(),
      releaseExpiredHolds: jest.fn().mockResolvedValue(2),
      completeDepartedBookings: jest.fn().mockResolvedValue(1),
    };

    const service = new ExpiryService(bookingPayments as any);
    const now = new Date();

    await expect(service.runScheduledChecks(now)).resolves.toEqual({
      released: 2,
      completed: 1,
    });
    expect(bookingPayments.releaseExpiredHolds).toHaveBeenCalledWith(now);
    expect(bookingPayments.completeDepartedBookings).toHaveBeenCalledWith(now);
  });
});
