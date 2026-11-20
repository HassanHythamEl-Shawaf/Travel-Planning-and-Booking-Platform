import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import { HotelBookingLifecycleService } from './hotel-booking-lifecycle.service';
import { HotelBookingStatus } from './hotel-booking-status';
import { DEFAULT_CANCELLATION_TERMS } from './refund-rules';

const ID = new Types.ObjectId().toHexString();
const USER = new Types.ObjectId().toHexString();
const HOTEL = new Types.ObjectId();
const NOW = new Date('2026-11-18T10:00:00Z');

const booking = (over: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(ID),
  userId: new Types.ObjectId(USER),
  hotelId: HOTEL,
  hotelName: 'Hilton Cairo',
  checkInDate: new Date('2026-12-20T00:00:00Z'),
  checkOutDate: new Date('2026-12-23T00:00:00Z'),
  nights: 3,
  rooms: [{}, {}],
  totalPrice: 751.5,
  currency: 'USD',
  status: HotelBookingStatus.PENDING_PAYMENT,
  holdExpiresAt: new Date('2026-11-18T10:05:00Z'),
  bookingReference: null,
  confirmedAt: null,
  ...over,
});

const resolves = (value: unknown) => ({ exec: () => Promise.resolve(value) });
const rejects = (error: unknown) => ({ exec: () => Promise.reject(error) });

function build() {
  const model = { findOneAndUpdate: jest.fn(), findById: jest.fn() };
  const rooms = {
    confirmRoomDates: jest.fn().mockResolvedValue(undefined),
    findCancellationTerms: jest.fn().mockResolvedValue(null),
  };
  const notifications = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new HotelBookingLifecycleService(
    model as never,
    rooms as never,
    notifications as never,
    {} as never, // connection: only the expiry paths use it
    {} as never, // inventory: only the expiry paths use it
  );
  return { service, model, rooms, notifications };
}

describe('HotelBookingLifecycleService.confirmBooking (HTL-17)', () => {
  it('confirms the whole reservation, issues a reference, books the dates and notifies', async () => {
    const { service, model, rooms, notifications } = build();
    model.findOneAndUpdate.mockReturnValue(
      resolves(
        booking({
          status: HotelBookingStatus.CONFIRMED,
          bookingReference: 'HTL-ABCD2345',
          confirmedAt: NOW,
          holdExpiresAt: null,
        }),
      ),
    );

    const result = await service.confirmBooking(ID, 'pi_123', NOW);

    const [filter, update] = model.findOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe(HotelBookingStatus.PENDING_PAYMENT);
    expect(filter.holdExpiresAt).toEqual({ $gt: NOW });
    expect(update.$set.status).toBe(HotelBookingStatus.CONFIRMED);
    expect(update.$set.bookingReference).toMatch(/^HTL-[A-Z2-9]{8}$/);
    expect(update.$set.holdExpiresAt).toBeNull();
    expect(update.$set.paymentIntentId).toBe('pi_123');

    expect(result).toMatchObject({
      id: ID,
      bookingReference: 'HTL-ABCD2345',
      status: HotelBookingStatus.CONFIRMED,
    });
    expect(rooms.confirmRoomDates).toHaveBeenCalledWith(ID, 'HTL-ABCD2345');
    expect(notifications.send).toHaveBeenCalledTimes(1);
    expect(notifications.send).toHaveBeenCalledWith(
      USER,
      expect.anything(),
      {
        bookingType: 'hotel',
        bookingId: ID,
        bookingReference: 'HTL-ABCD2345',
        providerType: 'hotel',
        providerId: String(HOTEL),
        hotelId: String(HOTEL),
        providerName: 'Hilton Cairo',
        amount: 751.5,
        currency: 'USD',
        excerpt: '2026-12-20 to 2026-12-23, 3 nights, 2 rooms',
      },
    );
  });

  it('retries with a new reference when the unique index rejects one', async () => {
    const { service, model } = build();
    model.findOneAndUpdate
      .mockReturnValueOnce(rejects({ code: 11000 }))
      .mockReturnValueOnce(
        resolves(
          booking({
            status: HotelBookingStatus.CONFIRMED,
            bookingReference: 'HTL-ZZZZ2222',
            confirmedAt: NOW,
          }),
        ),
      );
    await expect(service.confirmBooking(ID, undefined, NOW)).resolves.toMatchObject({
      bookingReference: 'HTL-ZZZZ2222',
    });
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not swallow other database errors', async () => {
    const { service, model } = build();
    model.findOneAndUpdate.mockReturnValue(rejects(new Error('db down')));
    await expect(service.confirmBooking(ID, undefined, NOW)).rejects.toThrow('db down');
  });

  it('is safe to repeat: returns the reference, retries the dates, notifies once', async () => {
    const { service, model, rooms, notifications } = build();
    model.findOneAndUpdate.mockReturnValue(resolves(null));
    model.findById.mockReturnValue(
      resolves(
        booking({
          status: HotelBookingStatus.CONFIRMED,
          bookingReference: 'HTL-ABCD2345',
          confirmedAt: NOW,
        }),
      ),
    );
    const result = await service.confirmBooking(ID, undefined, NOW);
    expect(result.bookingReference).toBe('HTL-ABCD2345');
    expect(rooms.confirmRoomDates).toHaveBeenCalledWith(ID, 'HTL-ABCD2345');
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('refuses a payment that arrived after the hold expired', async () => {
    const { service, model, rooms, notifications } = build();
    model.findOneAndUpdate.mockReturnValue(resolves(null));
    model.findById.mockReturnValue(
      resolves(booking({ holdExpiresAt: new Date('2026-11-18T09:00:00Z') })),
    );
    await expect(service.confirmBooking(ID, undefined, NOW)).rejects.toThrow(
      ConflictException,
    );
    expect(rooms.confirmRoomDates).not.toHaveBeenCalled();
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('refuses Cancelled and Expired bookings, and unknown ids', async () => {
    const { service, model } = build();
    model.findOneAndUpdate.mockReturnValue(resolves(null));
    for (const status of [
      HotelBookingStatus.CANCELLED,
      HotelBookingStatus.EXPIRED,
    ]) {
      model.findById.mockReturnValue(resolves(booking({ status })));
      await expect(service.confirmBooking(ID, undefined, NOW)).rejects.toThrow(
        ConflictException,
      );
    }
    model.findById.mockReturnValue(resolves(null));
    await expect(service.confirmBooking(ID, undefined, NOW)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.confirmBooking('not-an-id', undefined, NOW)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps the booking confirmed if marking the dates booked fails', async () => {
    const { service, model, rooms, notifications } = build();
    model.findOneAndUpdate.mockReturnValue(
      resolves(
        booking({
          status: HotelBookingStatus.CONFIRMED,
          bookingReference: 'HTL-ABCD2345',
          confirmedAt: NOW,
        }),
      ),
    );
    rooms.confirmRoomDates.mockRejectedValue(new Error('inventory down'));
    await expect(service.confirmBooking(ID, undefined, NOW)).resolves.toMatchObject({
      bookingReference: 'HTL-ABCD2345',
    });
    expect(notifications.send).toHaveBeenCalledTimes(1);
  });
});

describe('HotelBookingLifecycleService.getForPayment', () => {
  it('returns what payments needs', async () => {
    const { service, model } = build();
    model.findById.mockReturnValue(resolves(booking()));
    await expect(service.getForPayment(ID)).resolves.toEqual({
      id: ID,
      userId: USER,
      totalPrice: 751.5,
      currency: 'USD',
      status: HotelBookingStatus.PENDING_PAYMENT,
      holdExpiresAt: new Date('2026-11-18T10:05:00Z'),
      policySnapshot: {
        cancellationPolicy: DEFAULT_CANCELLATION_TERMS,
        checkInTime: '14:00',
        checkOutTime: '12:00',
      },
    });
  });

  it('converts the embedded cancellation policy to a plain snapshot', async () => {
    const { service, model } = build();
    const cancellationPolicy = { ...DEFAULT_CANCELLATION_TERMS };
    const hydratedPolicy = Object.assign(
      Object.create({ hydrated: true }),
      cancellationPolicy,
    );
    const plainBooking = booking({ cancellationPolicy });
    const hydratedBooking = {
      ...booking({ cancellationPolicy: hydratedPolicy }),
      toObject: () => plainBooking,
    };
    model.findById.mockReturnValue(resolves(hydratedBooking));

    const result = await service.getForPayment(ID);

    expect(result.policySnapshot).toEqual({
      cancellationPolicy,
      checkInTime: cancellationPolicy.checkInTime,
      checkOutTime: cancellationPolicy.checkOutTime,
    });
    expect(
      Object.getPrototypeOf(result.policySnapshot.cancellationPolicy),
    ).toBe(Object.prototype);
  });
});