import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ProviderOwnership } from '../auth/decorators/provider-ownership.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ProviderOwnershipGuard } from '../auth/guards/provider-ownership.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import {
  AirlineResponseDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { AirlinesService } from './airlines.service';

const ID_PARAM = {
  name: 'id',
  example: '6650f1c2a1b2c3d4e5f60718',
} as const;

@ApiTags('Airlines')
@Controller('airlines')
export class AirlinesController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post()
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create an airline profile (FLT-01)',
    description:
      'Administrator-only. New airlines are active by default. Airline logos are handled by Person 8 image-upload integration.',
  })
  @ApiCreatedResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline name, code or logo input' })
  @ApiConflictResponse({ description: 'Airline code already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Administrator role required' })
  create(@Body() dto: CreateAirlineDto): Promise<AirlineResponseDto> {
    return this.airlines.create(dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get an airline profile (FLT-01)',
    description: 'Public airline profile. The isActive flag is included for administration and search integration.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline id' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string): Promise<AirlineResponseDto> {
    return this.airlines.findOne(id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, RolesGuard, ProviderOwnershipGuard)
  @Roles(UserRole.MODERATOR)
  @ProviderOwnership('airline')
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit the assigned airline profile (FLT-01)',
    description:
      'Only an airline moderator assigned to this airline may edit its name, code or logo. Administrators use the separate provider deactivation endpoint.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ type: AirlineResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid airline id or body' })
  @ApiConflictResponse({ description: 'Duplicate airline code or empty update' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Assigned airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Airline not found' })
  update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateAirlineDto,
  ): Promise<AirlineResponseDto> {
    return this.airlines.update(id, dto);
  }
}
