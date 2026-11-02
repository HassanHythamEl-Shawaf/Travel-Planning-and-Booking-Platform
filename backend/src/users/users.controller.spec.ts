import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';

import { BookingEligibilityReader } from './booking-eligibility.reader';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController account deactivation', () => {
  let usersService: jest.Mocked<Pick<UsersService, 'deactivateAccount'>>;
  let bookingEligibility: jest.Mocked<
    Pick<BookingEligibilityReader, 'hasUpcomingConfirmedBookings'>
  >;
  let response: jest.Mocked<Pick<Response, 'clearCookie'>>;
  let controller: UsersController;

  const user = { sub: 'user-id' };
  const confirmation = { confirm: true } as DeactivateAccountDto;

  beforeEach(() => {
    usersService = {
      deactivateAccount: jest.fn().mockResolvedValue({
        _id: { toString: () => 'user-id' },
      }),
    };
    bookingEligibility = {
      hasUpcomingConfirmedBookings: jest.fn().mockResolvedValue(false),
    };
    response = {
      clearCookie: jest.fn(),
    };
    controller = new UsersController(
      usersService as UsersService,
      bookingEligibility as BookingEligibilityReader,
    );
  });

  it('refuses deactivation until booking eligibility is integrated', async () => {
    controller = new UsersController(usersService as UsersService);

    await expect(
      controller.deactivateMyAccount(user, confirmation, response as Response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(usersService.deactivateAccount).not.toHaveBeenCalled();
  });

  it('prevents deactivation when upcoming confirmed bookings exist', async () => {
    bookingEligibility.hasUpcomingConfirmedBookings.mockResolvedValue(true);

    await expect(
      controller.deactivateMyAccount(user, confirmation, response as Response),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersService.deactivateAccount).not.toHaveBeenCalled();
    expect(response.clearCookie).not.toHaveBeenCalled();
  });

  it('deactivates without upcoming bookings and clears auth cookies', async () => {
    await expect(
      controller.deactivateMyAccount(user, confirmation, response as Response),
    ).resolves.toEqual({ message: 'Account deactivated successfully' });

    expect(
      bookingEligibility.hasUpcomingConfirmedBookings,
    ).toHaveBeenCalledWith(user.sub);
    expect(usersService.deactivateAccount).toHaveBeenCalledWith(user.sub);
    expect(response.clearCookie).toHaveBeenCalledTimes(2);
  });
});
