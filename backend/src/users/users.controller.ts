import {
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Body,
  ConflictException,
  Inject,
  Optional,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BOOKING_ELIGIBILITY_READER } from './booking-eligibility.reader';
import type { BookingEligibilityReader } from './booking-eligibility.reader';
import { DeactivateAccountDto } from './dto/deactivate-account.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    @Optional()
    @Inject(BOOKING_ELIGIBILITY_READER)
    private readonly bookingEligibility?: BookingEligibilityReader,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile (ACC-11)' })
  @ApiOkResponse({ description: 'Current user profile' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  async getMyProfile(@CurrentUser() user: { sub: string }) {
    const result = await this.usersService.findById(user.sub);

    if (!result) {
      throw new NotFoundException('User not found');
    }

    return {
      id: result._id.toString(),
      name: result.name,
      email: result.email,
      role: result.role,
      status: result.status,
      phone: result.phone,
      preferredCurrency: result.preferredCurrency,
      createdAt: result.createdAt,
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user profile (ACC-09)' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({ description: 'Profile updated successfully' })
  @ApiBadRequestResponse({
    description: 'Invalid input or attempt to update a restricted field',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  async updateMyProfile(
    @CurrentUser() user: { sub: string },
    @Body() dto: UpdateProfileDto,
  ) {
    const updated = await this.usersService.updateProfile(user.sub, dto);

    if (!updated) {
      throw new NotFoundException('User not found');
    }

    return {
      message: 'Profile updated successfully',
      user: {
        id: updated._id.toString(),
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        preferredCurrency: updated.preferredCurrency,
      },
    };
  }

  @Delete('me')
  @ApiOperation({ summary: 'Deactivate current user account (ACC-12)' })
  @ApiBody({ type: DeactivateAccountDto })
  @ApiOkResponse({
    description: 'Account deactivated and authentication cookies cleared',
  })
  @ApiBadRequestResponse({
    description: 'Deactivation confirmation is required',
  })
  @ApiConflictResponse({
    description: 'Upcoming confirmed booking prevents deactivation',
  })
  @ApiServiceUnavailableResponse({
    description: 'Booking eligibility integration is not configured',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  async deactivateMyAccount(
    @CurrentUser() user: { sub: string },
    @Body() dto: DeactivateAccountDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!dto.confirm) {
      throw new ConflictException('Account deactivation was not confirmed');
    }

    if (!this.bookingEligibility) {
      throw new ServiceUnavailableException(
        'Flight and hotel booking eligibility integration is not configured',
      );
    }

    if (await this.bookingEligibility.hasUpcomingConfirmedBookings(user.sub)) {
      throw new ConflictException(
        'You cannot deactivate your account while you have upcoming confirmed bookings',
      );
    }

    const deactivated = await this.usersService.deactivateAccount(user.sub);

    if (!deactivated) {
      throw new NotFoundException('User not found');
    }

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    response.clearCookie('access_token', cookieOptions);
    response.clearCookie('refresh_token', cookieOptions);

    return { message: 'Account deactivated successfully' };
  }
}
