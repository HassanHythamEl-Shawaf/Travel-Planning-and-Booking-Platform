import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { Request } from 'express';

import { AuthService } from './auth.service';
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
      sameSite: production ? ('none' as const) : ('lax' as const),
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
  @ApiOperation({ summary: 'Register a new user account' })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in and receive authentication cookies' })
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
  @ApiOperation({ summary: 'Refresh authentication cookies' })
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
  @ApiOperation({ summary: 'Log out and revoke the refresh token' })
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
  @ApiOperation({ summary: 'Get the currently authenticated user' })
  async getMe(@CurrentUser() user: { sub: string }) {
    return this.authService.getMe(user.sub);
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Change current user password' })
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
