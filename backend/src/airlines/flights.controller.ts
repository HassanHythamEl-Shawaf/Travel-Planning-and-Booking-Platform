import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
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

import {
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import {
  CabinResponseDto,
  CreateCabinDto,
  UpdateCabinDto,
} from './dto/cabin.dto';
import { AirlinesService } from './airlines.service';

@ApiTags('Flights')
@ApiCookieAuth('access_token')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.MODERATOR)
@Controller('flights')
export class FlightsController {
  constructor(private readonly airlines: AirlinesService) {}

  @Post(':id/cabins')
  @ApiOperation({
    summary: 'Add a cabin category to a flight (FLT-04)',
    description:
      'The assigned airline moderator may add each fixed cabin category at most once to their flight.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60719' })
  @ApiCreatedResponse({ type: CabinResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight or cabin input' })
  @ApiConflictResponse({ description: 'Cabin category already exists' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Flight not found' })
  addCabin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: CreateCabinDto,
  ): Promise<CabinResponseDto> {
    return this.airlines.addCabin(user.sub, id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @ApiOperation({
    summary: 'Edit a flight cabin (FLT-04)',
    description: 'Updates cabin capacity, price and baggage allowance for the assigned moderator.',
  })
  @ApiParam({ name: 'id', example: '6650f1c2a1b2c3d4e5f60719' })
  @ApiParam({ name: 'cabinId', example: '6650f1c2a1b2c3d4e5f60720' })
  @ApiOkResponse({ type: CabinResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid flight, cabin or body' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Airline moderator role required' })
  @ApiNotFoundResponse({ description: 'Flight or cabin not found' })
  updateCabin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('cabinId', ParseObjectIdPipe) cabinId: string,
    @Body() dto: UpdateCabinDto,
  ): Promise<CabinResponseDto> {
    return this.airlines.updateCabin(user.sub, id, cabinId, dto);
  }
}
