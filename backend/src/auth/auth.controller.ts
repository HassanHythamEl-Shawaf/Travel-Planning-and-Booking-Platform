import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import type { Response } from 'express';
import type { Request } from 'express';

import { AuthService } from './auth.service';
import { AllowPasswordChange } from './decorators/allow-password-change.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private cookieOptions() {
    const production = process.env.NODE_ENV === 'production';

    return {
      httpOnly: true,
      secure: production,
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  private setTokens(
    response: Response,
    tokens: { accessToken: string; refreshToken: string },
  ) {
    const options = this.cookieOptions();

    response.cookie('access_token', tokens.accessToken, {
      ...options,
      maxAge: 30 * 60 * 1000,
    });

    response.cookie('refresh_token', tokens.refreshToken, {
      ...options,
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account (ACC-01)' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ description: 'User registered successfully' })
  @ApiBadRequestResponse({ description: 'Invalid input or missing consent' })
  @ApiConflictResponse({ description: 'Email is already registered' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({
    summary:
      'Log in and receive authentication cookies (ACC-04, ACC-05, ACC-19)',
  })
  @ApiBody({ type: LoginDto })
  @ApiCreatedResponse({ description: 'Login successful; auth cookies set' })
  @ApiBadRequestResponse({ description: 'Invalid input' })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiForbiddenResponse({ description: 'Account is suspended or deactivated' })
  @ApiTooManyRequestsResponse({
    description: 'Account login is temporarily locked',
  })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto);
    this.setTokens(response, result);

    return {
      message: 'Login successful',
      user: result.user,
    };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh authentication cookies (ACC-06, ACC-19)' })
  @ApiCreatedResponse({
    description: 'Session refreshed; auth cookies rotated',
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is invalid or expired',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.refresh(
      request.cookies?.refresh_token,
    );

    this.setTokens(response, result);

    return {
      message: 'Session refreshed',
      user: result.user,
    };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @AllowPasswordChange()
  @ApiOperation({ summary: 'Log out and revoke the refresh token (ACC-06)' })
  @ApiCreatedResponse({ description: 'Session revoked and cookies cleared' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  async logout(
    @CurrentUser() user: { sub: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(user.sub);

    response.clearCookie('access_token', this.cookieOptions());
    response.clearCookie('refresh_token', this.cookieOptions());

    return result;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get the currently authenticated user (ACC-04, ACC-19)',
  })
  @ApiOkResponse({ description: 'Current authenticated user profile' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  async getMe(@CurrentUser() user: { sub: string }) {
    return this.authService.getMe(user.sub);
  }

  @Patch('change-password')
  @UseGuards(AuthGuard)
  @AllowPasswordChange()
  @ApiOperation({ summary: 'Change current user password (ACC-08)' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({ description: 'Password changed and session revoked' })
  @ApiBadRequestResponse({ description: 'Password does not meet requirements' })
  @ApiUnauthorizedResponse({ description: 'Current password is incorrect' })
  @ApiForbiddenResponse({
    description: 'New password must differ from current password',
  })
  async changePassword(
    @CurrentUser() user: { sub: string },
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.changePassword(user.sub, dto);

    response.clearCookie('access_token', this.cookieOptions());
    response.clearCookie('refresh_token', this.cookieOptions());

    return result;
  }
}
