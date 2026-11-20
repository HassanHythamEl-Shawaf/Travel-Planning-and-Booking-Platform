import {
  applyDecorators,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  type AuthenticatedUser,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ImageFileInterceptor } from '../uploads/image-file.interceptor';
import {
  AddDayDto,
  ConfirmDto,
  CreateActivityDto,
  CreateBudgetEntryDto,
  CreateTransportEntryDto,
  LinkBookingDto,
  MoveDayDto,
  UpdateActivityDto,
  UpdateBudgetEntryDto,
  UpdateDayDto,
  UpdateTransportEntryDto,
} from './dto/itinerary-requests.dto';
import { ItineraryDetailDto } from './dto/itinerary-responses.dto';
import { ItineraryItemsService } from './itinerary-items.service';
import type { ItineraryView } from './itinerary-view';
import { ITINERARY_ID_PARAM } from './itineraries.controller';
import { CONFLICT, NOT_OWNER } from './itineraries.service';

const EXAMPLE_ID = '6650f1c2a1b2c3d4e5f60718';
const DAY_ID = { name: 'dayId', example: EXAMPLE_ID };
const ACTIVITY_ID = { name: 'activityId', example: EXAMPLE_ID };
const ENTRY_ID = { name: 'entryId', example: EXAMPLE_ID };
const LINK_ID = { name: 'linkId', example: EXAMPLE_ID };

/**
 * Shared decorators for an owner-only change: logged in, the owner, and
 * the whole updated itinerary back. Keeps every route below short.
 */
function OwnerChange(summary: string, description: string, notFound: string) {
  return applyDecorators(
    UseGuards(AuthGuard),
    ApiCookieAuth('access_token'),
    ApiOperation({ summary, description }),
    ApiParam(ITINERARY_ID_PARAM),
    ApiOkResponse({
      type: ItineraryDetailDto,
      description: 'The updated itinerary',
    }),
    ApiBadRequestResponse({
      description: 'Invalid id or body, or a limit reached',
    }),
    ApiUnauthorizedResponse({ description: 'Authentication is required' }),
    ApiForbiddenResponse({ description: NOT_OWNER }),
    ApiNotFoundResponse({ description: notFound }),
    ApiConflictResponse({ description: CONFLICT }),
  );
}

@ApiTags('Itinerary days, activities and budget')
@Controller('itineraries/:id')
export class ItineraryItemsController {
  constructor(private readonly items: ItineraryItemsService) {}

  // ---------------------------------------------------------------- days

  @Post('days')
  @HttpCode(200)
  @OwnerChange(
    'Add a day (ITN-05)',
    'At the end, or at `position`. Days are numbered by position and dated from the start date. At most 60 days. The city must be in the city list (GET /api/cities).',
    'Itinerary not found',
  )
  addDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddDayDto,
  ): Promise<ItineraryView> {
    return this.items.addDay(id, user, dto);
  }

  @Patch('days/:dayId')
  @OwnerChange(
    "Change a day's city or notes (ITN-05, ITN-09)",
    'City groups follow the change.',
    'Itinerary or day not found',
  )
  @ApiParam(DAY_ID)
  updateDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateDayDto,
  ): Promise<ItineraryView> {
    return this.items.updateDay(id, dayId, user, dto);
  }

  @Delete('days/:dayId')
  @OwnerChange(
    'Delete a day (ITN-07)',
    'Body { "confirm": true }. The remaining days are renumbered and re-dated, and the budget totals recalculated. The day\'s transport entries and activity images are deleted too.',
    'Itinerary or day not found',
  )
  @ApiParam(DAY_ID)
  removeDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() _confirm: ConfirmDto,
  ): Promise<ItineraryView> {
    return this.items.removeDay(id, dayId, user);
  }

  @Patch('days/:dayId/position')
  @OwnerChange(
    'Move a day to a new position (ITN-08)',
    'Days are renumbered and re-dated; city groups are recalculated. Transport entries stay on their day.',
    'Itinerary or day not found',
  )
  @ApiParam(DAY_ID)
  moveDay(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: MoveDayDto,
  ): Promise<ItineraryView> {
    return this.items.moveDay(id, dayId, user, dto);
  }

  // ---------------------------------------------------------- activities

  @Post('days/:dayId/activities')
  @HttpCode(200)
  @OwnerChange(
    'Add an activity to a day (ITN-10)',
    'Name, description, optional time, optional cost with currency (counted under the Activities budget). At most 20 per day.',
    'Itinerary or day not found',
  )
  @ApiParam(DAY_ID)
  addActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateActivityDto,
  ): Promise<ItineraryView> {
    return this.items.addActivity(id, dayId, user, dto);
  }

  @Patch('days/:dayId/activities/:activityId')
  @OwnerChange(
    'Edit an activity (ITN-10)',
    'Send only the fields to change. null clears time, or cost and currency.',
    'Itinerary, day or activity not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ACTIVITY_ID)
  updateActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateActivityDto,
  ): Promise<ItineraryView> {
    return this.items.updateActivity(id, dayId, activityId, user, dto);
  }

  @Delete('days/:dayId/activities/:activityId')
  @OwnerChange(
    'Delete an activity (ITN-10)',
    'Its images are deleted too.',
    'Itinerary, day or activity not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ACTIVITY_ID)
  removeActivity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.items.removeActivity(id, dayId, activityId, user);
  }

  @Post('days/:dayId/activities/:activityId/images')
  @HttpCode(200)
  @UseInterceptors(ImageFileInterceptor('file'))
  @OwnerChange(
    'Attach an image to an activity (ITN-12, GEN-08)',
    'Multipart field "file": JPG or PNG, up to 5 MB, at most 5 images per activity.',
    'Itinerary, day or activity not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ACTIVITY_ID)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  addActivityImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: unknown,
  ): Promise<ItineraryView> {
    return this.items.addActivityImage(id, dayId, activityId, user, file);
  }

  @Delete('days/:dayId/activities/:activityId/images/:imageId')
  @OwnerChange(
    'Remove an image from an activity (ITN-12)',
    'Removes it from the activity, then deletes the file.',
    'Itinerary, day, activity or image not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ACTIVITY_ID)
  @ApiParam({ name: 'imageId', example: EXAMPLE_ID })
  removeActivityImage(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('activityId', ParseObjectIdPipe) activityId: string,
    @Param('imageId') imageId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.items.removeActivityImage(id, dayId, activityId, imageId, user);
  }

  // -------------------------------------------------------------- budget

  @Post('days/:dayId/budget-entries')
  @HttpCode(200)
  @OwnerChange(
    'Add a budget entry to a day (ITN-14)',
    'Category food, accommodation, in_city_transport or activities; amount 0 or more in a supported currency. At most 30 per day.',
    'Itinerary or day not found',
  )
  @ApiParam(DAY_ID)
  addBudgetEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBudgetEntryDto,
  ): Promise<ItineraryView> {
    return this.items.addBudgetEntry(id, dayId, user, dto);
  }

  @Patch('days/:dayId/budget-entries/:entryId')
  @OwnerChange(
    'Edit a budget entry (ITN-14)',
    'Send only the fields to change.',
    'Itinerary, day or entry not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ENTRY_ID)
  updateBudgetEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('entryId', ParseObjectIdPipe) entryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateBudgetEntryDto,
  ): Promise<ItineraryView> {
    return this.items.updateBudgetEntry(id, dayId, entryId, user, dto);
  }

  @Delete('days/:dayId/budget-entries/:entryId')
  @OwnerChange(
    'Delete a budget entry (ITN-14)',
    'Totals are recalculated.',
    'Itinerary, day or entry not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(ENTRY_ID)
  removeBudgetEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('entryId', ParseObjectIdPipe) entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.items.removeBudgetEntry(id, dayId, entryId, user);
  }

  // ------------------------------------------------ linked bookings (bonus)

  @Post('days/:dayId/bookings')
  @HttpCode(200)
  @OwnerChange(
    'Link one of my bookings to a day (ITN-27, bonus)',
    "Links one of your own Confirmed (or Completed) flight bookings or hotel reservations to a day. Its price then feeds the budget: `days[].bookings`, `budget.byDay[].bookings`, `budget.bookings` (by type) and `budget.totalWithBookings`. Booking prices stay in the platform currency and are never converted (PAY-04). The price and status are read live, so a booking cancelled later no longer counts (`counted: false`). Linked bookings are shown only to you, never to other viewers of a public itinerary, and are not copied by clone. 404 if the booking isn't yours; 409 if it isn't Confirmed or Completed, or is already linked to this itinerary. At most 10 per day.",
    'Itinerary, day or booking not found',
  )
  @ApiParam(DAY_ID)
  linkBooking(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LinkBookingDto,
  ): Promise<ItineraryView> {
    return this.items.linkBooking(id, dayId, user, dto);
  }

  @Delete('days/:dayId/bookings/:linkId')
  @OwnerChange(
    'Unlink a booking from a day (ITN-27, bonus)',
    'Removes the link only; the booking itself is not changed or cancelled. Totals are recalculated.',
    'Itinerary, day or linked booking not found',
  )
  @ApiParam(DAY_ID)
  @ApiParam(LINK_ID)
  unlinkBooking(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('dayId', ParseObjectIdPipe) dayId: string,
    @Param('linkId', ParseObjectIdPipe) linkId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.items.unlinkBooking(id, dayId, linkId, user);
  }

  // ----------------------------------------------------------- transport

  @Post('transport-entries')
  @HttpCode(200)
  @OwnerChange(
    'Add an intercity transport cost (ITN-16)',
    'Mode, from-city, to-city, amount, currency and the day it belongs to. It stays on that day when days move, and is deleted with it. At most 100 per itinerary.',
    'Itinerary not found',
  )
  addTransportEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTransportEntryDto,
  ): Promise<ItineraryView> {
    return this.items.addTransportEntry(id, user, dto);
  }

  @Patch('transport-entries/:entryId')
  @OwnerChange(
    'Edit a transport entry (ITN-16)',
    'Send only the fields to change.',
    'Itinerary or entry not found',
  )
  @ApiParam(ENTRY_ID)
  updateTransportEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('entryId', ParseObjectIdPipe) entryId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateTransportEntryDto,
  ): Promise<ItineraryView> {
    return this.items.updateTransportEntry(id, entryId, user, dto);
  }

  @Delete('transport-entries/:entryId')
  @OwnerChange(
    'Delete a transport entry (ITN-16)',
    'Totals are recalculated.',
    'Itinerary or entry not found',
  )
  @ApiParam(ENTRY_ID)
  removeTransportEntry(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('entryId', ParseObjectIdPipe) entryId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ItineraryView> {
    return this.items.removeTransportEntry(id, entryId, user);
  }
}
