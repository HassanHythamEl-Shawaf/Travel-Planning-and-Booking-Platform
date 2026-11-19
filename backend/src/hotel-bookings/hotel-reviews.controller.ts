import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
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

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { UserRole } from '../users/schemas/user.schema';
import { CreateReviewDto } from './dto/create-review.dto';
import { ListReviewsQueryDto } from './dto/list-reviews.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { HotelReviewsService } from './hotel-reviews.service';
import type { HotelReviewList, MyReview } from './hotel-reviews.service';

@ApiTags('Hotel Reviews')
@Controller()
export class HotelReviewsController {
  constructor(private readonly reviews: HotelReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Review a completed stay (HTL-23)',
    description:
      'One rating (1-5) and an optional comment (max 1000 characters) per reservation, whatever its number of rooms. Only for a Completed reservation, or a Confirmed one whose check-out date has passed. The hotel average rating is recalculated.',
  })
  @ApiParam({ name: 'id', description: 'The hotel booking id' })
  @ApiCreatedResponse({ description: 'The review' })
  @ApiBadRequestResponse({ description: 'Invalid id, rating or comment' })
  @ApiNotFoundResponse({ description: 'No such booking of yours' })
  @ApiConflictResponse({
    description: 'The stay is not completed, or it already has a review',
  })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) bookingId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<MyReview> {
    return this.reviews.create(user.sub, bookingId, dto);
  }

  @Patch('reviews/:id')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description:
      'Change the rating and/or comment of your own review. An empty comment removes it. The hotel average rating is recalculated.',
  })
  @ApiParam({ name: 'id', description: 'The review id' })
  @ApiOkResponse({ description: 'The updated review' })
  @ApiBadRequestResponse({ description: 'Invalid id, rating or comment, or nothing to change' })
  @ApiNotFoundResponse({ description: 'No such review of yours' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<MyReview> {
    return this.reviews.update(user.sub, id, dto);
  }

  @Delete('reviews/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(UserRole.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description:
      'Deletes your own review and recalculates the hotel average rating. The stay can then be reviewed again.',
  })
  @ApiParam({ name: 'id', description: 'The review id' })
  @ApiOkResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'Invalid review id' })
  @ApiNotFoundResponse({ description: 'No such review of yours' })
  @ApiUnauthorizedResponse({ description: 'Authentication is required' })
  @ApiForbiddenResponse({ description: 'Registered user role required' })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<{ deleted: true; reviewId: string }> {
    return this.reviews.remove(user.sub, id);
  }

  @Get('hotels/:id/reviews')
  @ApiOperation({
    summary: "List a hotel's reviews (HTL-24)",
    description:
      'Public (guests and registered users). Returns the hotel average rating, the number of ratings and the reviews, newest first, 10 per page. Hidden reviews are not listed or counted.',
  })
  @ApiParam({ name: 'id', description: 'The hotel id' })
  @ApiOkResponse({
    description: 'averageRating, ratingCount and a page of reviews',
  })
  @ApiBadRequestResponse({ description: 'Invalid hotel id or page' })
  @ApiNotFoundResponse({ description: 'Hotel not found or deactivated' })
  list(
    @Param('id', ParseObjectIdPipe) hotelId: string,
    @Query() query: ListReviewsQueryDto,
  ): Promise<HotelReviewList> {
    return this.reviews.listForHotel(hotelId, query.page);
  }
}