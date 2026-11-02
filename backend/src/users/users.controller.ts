import {
  Controller,
  Get,
  NotFoundException,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthGuard } from '../auth/guards/auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
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
  @ApiOperation({ summary: 'Update current user profile' })
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
}
