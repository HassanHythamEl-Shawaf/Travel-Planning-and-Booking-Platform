import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const CONVERTED = {
  example: 9.2,
  nullable: true,
  description: 'ITN-18: in budget.conversion.currency.',
};

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  BOOKING_LINK_TYPES,
  BUDGET_CATEGORIES,
  type BudgetCategory,
  TRANSPORT_MODES,
} from '../itineraries.constants';

/**
 * Swagger classes for the shapes built in itinerary-view.ts. They only
 * describe the responses; the values come from toItineraryView().
 */

const ID = '6650f1c2a1b2c3d4e5f60718';

export class MoneyDto {
  @ApiProperty({ example: 'EGP' })
  currency: string;

  @ApiProperty({ example: 1250.5 })
  amount: number;
}

export class TotalsDto {
  @ApiProperty({
    type: [MoneyDto],
    description: 'One amount per currency, sorted by currency code.',
  })
  amounts: MoneyDto[];

  @ApiPropertyOptional({
    example: 61.42,
    nullable: true,
    description:
      'ITN-18: the same total in budget.conversion.currency (rounded to 2 decimals).',
  })
  converted?: number | null;
}

export class BudgetConversionDto {
  @ApiProperty({ example: 'USD', description: 'The display currency.' })
  currency: string;

  @ApiProperty({
    example: '2026-11-16',
    description: "The provider's rate date.",
  })
  rateDate: string;

  @ApiProperty({
    example: false,
    description:
      'true if the API was unavailable and older cached rates were used.',
  })
  usingCachedRates: boolean;
}

export class BudgetByCategoryDto {
  @ApiProperty({ type: TotalsDto })
  food: TotalsDto;

  @ApiProperty({ type: TotalsDto })
  accommodation: TotalsDto;

  @ApiProperty({ type: TotalsDto })
  in_city_transport: TotalsDto;

  @ApiProperty({
    type: TotalsDto,
    description: 'Activity budget entries plus activity costs.',
  })
  activities: TotalsDto;

  @ApiProperty({ type: TotalsDto, description: 'Transport entries (ITN-16).' })
  intercity_transport: TotalsDto;
}

export class DayTotalDto {
  @ApiProperty({ example: ID })
  dayId: string;

  @ApiProperty({ example: 1 })
  dayNumber: number;

  @ApiProperty({ example: '2026-12-20', nullable: true })
  date: string | null;

  @ApiProperty({ type: TotalsDto })
  total: TotalsDto;

  @ApiProperty({
    type: TotalsDto,
    description:
      "ITN-27 (bonus): this day's linked bookings that count (owner only). Never converted (PAY-04).",
  })
  bookings: TotalsDto;
}

export class BookingsBudgetDto {
  @ApiProperty({ type: TotalsDto, description: 'Linked flight bookings.' })
  flight: TotalsDto;

  @ApiProperty({ type: TotalsDto, description: 'Linked hotel reservations.' })
  hotel: TotalsDto;

  @ApiProperty({ type: TotalsDto, description: 'Both together.' })
  total: TotalsDto;
}

export class BudgetSummaryDto {
  @ApiProperty({ type: BudgetByCategoryDto })
  byCategory: BudgetByCategoryDto;

  @ApiProperty({ type: [DayTotalDto] })
  byDay: DayTotalDto[];

  @ApiProperty({
    type: TotalsDto,
    description:
      'Planned costs: budget entries, activity costs and transport (ITN-14, ITN-16). Converted by ITN-18.',
  })
  total: TotalsDto;

  @ApiProperty({
    type: BookingsBudgetDto,
    description:
      "ITN-27 (bonus): prices of the owner's linked Confirmed or Completed bookings. Empty for other viewers. Never converted (PAY-04).",
  })
  bookings: BookingsBudgetDto;

  @ApiProperty({
    type: TotalsDto,
    description:
      'ITN-27 (bonus): `total` plus `bookings.total`, one amount per currency. Never converted, because it may include booking prices (PAY-04).',
  })
  totalWithBookings: TotalsDto;

  @ApiPropertyOptional({ type: BudgetConversionDto, nullable: true })
  conversion?: BudgetConversionDto | null;

  @ApiPropertyOptional({
    nullable: true,
    example: null,
    description:
      'Why nothing was converted (e.g. no exchange rates available).',
  })
  conversionError?: string | null;
}

export class CityGroupDto {
  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'Cairo', nullable: true })
  cityName: string | null;

  @ApiProperty({ example: 1 })
  firstDayNumber: number;

  @ApiProperty({ example: 3 })
  lastDayNumber: number;

  @ApiProperty({ example: 3 })
  dayCount: number;

  @ApiProperty({ example: '2026-12-20', nullable: true })
  startDate: string | null;

  @ApiProperty({ example: '2026-12-22', nullable: true })
  endDate: string | null;

  @ApiProperty({ type: TotalsDto })
  subtotal: TotalsDto;
}

export class ActivityImageDto {
  @ApiProperty({ example: ID })
  imageId: string;

  @ApiProperty({
    example: '/api/uploads/3f1c2a9e-8b4d-4c1e-9f2a-7d6e5b4a3c21.jpg',
  })
  url: string;
}

export class ActivityDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Egyptian Museum' })
  name: string;

  @ApiProperty({ example: 'Mummies room' })
  description: string;

  @ApiProperty({ example: '09:30', nullable: true })
  time: string | null;

  @ApiProperty({ example: 450, nullable: true })
  cost: number | null;

  @ApiProperty({ example: 'EGP', nullable: true })
  currency: string | null;

  @ApiPropertyOptional(CONVERTED)
  convertedCost?: number | null;

  @ApiProperty({ type: [ActivityImageDto] })
  images: ActivityImageDto[];
}

export class BudgetEntryDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ enum: BUDGET_CATEGORIES, example: 'food' })
  category: BudgetCategory;

  @ApiProperty({ example: 350 })
  amount: number;

  @ApiProperty({ example: 'EGP' })
  currency: string;

  @ApiPropertyOptional(CONVERTED)
  convertedAmount?: number | null;

  @ApiProperty({ example: 'Dinner on the Nile' })
  note: string;
}

export class DayDto {
  @ApiProperty({
    example: ID,
    description: 'Stable id; does not change when days move.',
  })
  id: string;

  @ApiProperty({
    example: 1,
    description: 'Position in the itinerary (1 = first).',
  })
  dayNumber: number;

  @ApiProperty({
    example: '2026-12-20',
    nullable: true,
    description: 'Start date + (dayNumber - 1).',
  })
  date: string | null;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'Cairo', nullable: true })
  cityName: string | null;

  @ApiProperty({ example: 'Arrive in the evening' })
  notes: string;

  @ApiProperty({ type: [ActivityDto] })
  activities: ActivityDto[];

  @ApiProperty({ type: [BudgetEntryDto] })
  budgetEntries: BudgetEntryDto[];

  @ApiProperty({
    type: () => [BookingLinkDto],
    description:
      'ITN-27 (bonus): bookings linked to this day, read live. Only the owner sees them; empty for everyone else.',
  })
  bookings: BookingLinkDto[];
}

export class BookingLinkDto {
  @ApiProperty({ example: ID, description: 'Id of the link (for unlinking).' })
  id: string;

  @ApiProperty({ enum: BOOKING_LINK_TYPES, example: 'flight' })
  type: string;

  @ApiProperty({ example: ID })
  bookingId: string;

  @ApiProperty({
    example: 'Confirmed',
    nullable: true,
    description: 'Live booking status; null if the booking no longer exists.',
  })
  status: string | null;

  @ApiProperty({
    example: true,
    description:
      'Whether its price counts in the budget (only Confirmed or Completed).',
  })
  counted: boolean;

  @ApiProperty({ example: 'K7QM2X', nullable: true })
  bookingReference: string | null;

  @ApiProperty({
    example: 'Nile Air',
    nullable: true,
    description: 'Airline or hotel name.',
  })
  providerName: string | null;

  @ApiProperty({
    example: '2026-12-20T06:00:00.000Z',
    nullable: true,
    description: 'Flight: outbound departure (UTC). Hotel: check-in date.',
  })
  startsAt: string | null;

  @ApiProperty({
    example: 250,
    nullable: true,
    description:
      'Total price in the platform currency; never converted (PAY-04).',
  })
  totalPrice: number | null;

  @ApiProperty({ example: 'USD', nullable: true })
  currency: string | null;
}

export class TransportEntryDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: ID })
  dayId: string;

  @ApiProperty({ example: 2, nullable: true })
  dayNumber: number | null;

  @ApiProperty({ enum: TRANSPORT_MODES, example: 'train' })
  mode: string;

  @ApiProperty({ example: 'cairo' })
  fromCityId: string;

  @ApiProperty({ example: 'Cairo', nullable: true })
  fromCityName: string | null;

  @ApiProperty({ example: 'luxor' })
  toCityId: string;

  @ApiProperty({ example: 'Luxor', nullable: true })
  toCityName: string | null;

  @ApiProperty({ example: 900 })
  amount: number;

  @ApiProperty({ example: 'EGP' })
  currency: string;

  @ApiPropertyOptional(CONVERTED)
  convertedAmount?: number | null;

  @ApiProperty({ example: 'Sleeper train' })
  note: string;
}

export class CountryRefDto {
  @ApiProperty({ example: 'EG' })
  code: string;

  @ApiProperty({ example: 'Egypt', nullable: true })
  name: string | null;
}

export class PersonRefDto {
  @ApiProperty({
    example: ID,
    nullable: true,
    description: 'null for a deleted user.',
  })
  id: string | null;

  @ApiProperty({ example: 'Hammad' })
  name: string;
}

export class ClonedFromDto {
  @ApiProperty({ example: ID })
  itineraryId: string;

  @ApiProperty({
    type: PersonRefDto,
    description: 'The original author, credited.',
  })
  author: PersonRefDto;
}

export class ItineraryDetailDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ type: [CountryRefDto] })
  countries: CountryRefDto[];

  @ApiProperty({ example: '2026-12-20', nullable: true })
  startDate: string | null;

  @ApiProperty({
    example: '2026-12-29',
    nullable: true,
    description: 'Date of the last day.',
  })
  endDate: string | null;

  @ApiProperty({ example: 10 })
  dayCount: number;

  @ApiProperty({ example: false })
  isPublic: boolean;

  @ApiProperty({ example: false, description: 'Hidden by an admin (GEN-10).' })
  isHidden: boolean;

  @ApiProperty({
    example: true,
    description: 'false: read-only for this viewer.',
  })
  isOwner: boolean;

  @ApiProperty({ type: PersonRefDto })
  author: PersonRefDto;

  @ApiProperty({ type: ClonedFromDto, nullable: true })
  clonedFrom: ClonedFromDto | null;

  @ApiProperty({ type: [DayDto] })
  days: DayDto[];

  @ApiProperty({
    type: [CityGroupDto],
    description: 'Consecutive days in the same city (ITN-09).',
  })
  cityGroups: CityGroupDto[];

  @ApiProperty({ type: [TransportEntryDto] })
  transportEntries: TransportEntryDto[];

  @ApiProperty({ type: BudgetSummaryDto })
  budget: BudgetSummaryDto;

  @ApiProperty({ nullable: true })
  createdAt: Date | null;

  @ApiProperty({ nullable: true })
  updatedAt: Date | null;
}

/** A row in "my itineraries" (ITN-03) and public search (ITN-21). */
export class ItineraryListItemDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Ten days in Egypt' })
  title: string;

  @ApiProperty({ type: [CountryRefDto] })
  countries: CountryRefDto[];

  @ApiProperty({ example: '2026-12-20', nullable: true })
  startDate: string | null;

  @ApiProperty({ example: 10 })
  dayCount: number;

  @ApiProperty({ example: false })
  isPublic: boolean;

  @ApiProperty({ example: false })
  isHidden: boolean;

  @ApiProperty({ type: PersonRefDto })
  author: PersonRefDto;

  @ApiProperty({ nullable: true })
  createdAt: Date | null;

  @ApiProperty({ nullable: true })
  updatedAt: Date | null;
}

export class ItineraryListDto extends PaginatedResponseDto {
  @ApiProperty({ type: [ItineraryListItemDto] })
  items: ItineraryListItemDto[];
}

export class ItineraryDeletedDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: true })
  deleted: true;
}
