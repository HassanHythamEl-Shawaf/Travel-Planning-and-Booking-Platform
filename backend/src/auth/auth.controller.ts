import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user account',
  })
  @ApiCreatedResponse({
    description: 'User registered successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid input or missing consent',
  })
  @ApiConflictResponse({
    description: 'Email is already registered',
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }
}