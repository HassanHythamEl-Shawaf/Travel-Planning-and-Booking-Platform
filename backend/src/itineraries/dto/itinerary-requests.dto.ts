import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { PageQueryDto } from '../../common/dto/page-query.dto';
import {
  ACTIVITY_DESCRIPTION_MAX,
  ACTIVITY_NAME_MAX,
  BUDGET_CATEGORIES,
  type BudgetCategory,
  COUNTRY_CODE_PATTERN,
  CURRENCY_PATTERN,
  DATE_ONLY_PATTERN,
  DAY_NOTES_MAX,
  ENTRY_NOTE_MAX,
  ITINERARY_TITLE_MAX,
  MAX_AMOUNT,
  MAX_COUNTRIES,
  MAX_DAYS,
  TIME_PATTERN,
  TRANSPORT_MODES,
  type TransportMode,
} from '../itineraries.constants';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const CITY_ID_MAX = 100;
const SEARCH_QUERY_MAX = 100;

/** A money amount: 0 or more, at most 2 decimals. */
const Amount = () =>
  IsNumber(
    { maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false },
    { message: '$property must be a number with at most 2 decimals' },
  );

// ------------------------------------------------------------- itinerary

export class CreateItineraryDto {
  @ApiProperty({ example: 'Ten days in Egypt', maxLength: ITINERARY_TITLE_MAX })
  @Transform(trim)
  @IsString()
  @Length(1, ITINERARY_TITLE_MAX)
  title: string;

  @ApiProperty({
    example: ['EG'],
    description:
      'Country codes from the reference data (GET /api/countries). At least one.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COUNTRIES)
  @Matches(COUNTRY_CODE_PATTERN, {
    each: true,
    message: 'each country must be a 2-letter code like EG',
  })
  countries: string[];

  @ApiProperty({
    example: '2026-12-20',
    description: 'Date of day 1 (YYYY-MM-DD).',
  })
  @Matches(DATE_ONLY_PATTERN, { message: 'startDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'startDate must be a real date' })
  startDate: string;
}

export class UpdateItineraryDto {
  @ApiPropertyOptional({
    example: 'Two weeks in Egypt',
    maxLength: ITINERARY_TITLE_MAX,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, ITINERARY_TITLE_MAX)
  title?: string;

  @ApiPropertyOptional({ example: ['EG', 'JO'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COUNTRIES)
  @Matches(COUNTRY_CODE_PATTERN, {
    each: true,
    message: 'each country must be a 2-letter code like EG',
  })
  countries?: string[];

  @ApiPropertyOptional({
    example: '2026-12-22',
    description: "Changing it moves every day's date with it.",
  })
  @IsOptional()
  @Matches(DATE_ONLY_PATTERN, { message: 'startDate must be YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'startDate must be a real date' })
  startDate?: string;
}

/** ITN-20 */
export class VisibilityDto {
  @ApiProperty({
    example: true,
    description: 'true = Public, false = Private.',
  })
  @IsBoolean()
  isPublic: boolean;
}

/** GEN-03: destructive actions need { "confirm": true }. */
export class ConfirmDto {
  @ApiProperty({ example: true, description: 'Must be true.' })
  @Equals(true, { message: 'confirm must be true' })
  confirm: true;
}

// ------------------------------------------------------------------ days

export class AddDayDto {
  @ApiProperty({
    example: 'cairo',
    description: 'City id from GET /api/cities.',
  })
  @IsString()
  @Length(1, CITY_ID_MAX)
  cityId: string;

  @ApiPropertyOptional({
    example: 'Arrive in the evening',
    maxLength: DAY_NOTES_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(DAY_NOTES_MAX)
  notes?: string;

  @ApiPropertyOptional({
    example: 2,
    description: 'Where to insert it (1 = first). Default: at the end.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  position?: number;
}

export class UpdateDayDto {
  @ApiPropertyOptional({ example: 'luxor' })
  @IsOptional()
  @IsString()
  @Length(1, CITY_ID_MAX)
  cityId?: string;

  @ApiPropertyOptional({
    example: 'Valley of the Kings early',
    maxLength: DAY_NOTES_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(DAY_NOTES_MAX)
  notes?: string;
}

/** ITN-08 */
export class MoveDayDto {
  @ApiProperty({ example: 1, description: 'New position (1 = first).' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DAYS)
  position: number;
}

// ------------------------------------------------------------ activities

export class CreateActivityDto {
  @ApiProperty({ example: 'Egyptian Museum', maxLength: ACTIVITY_NAME_MAX })
  @Transform(trim)
  @IsString()
  @Length(1, ACTIVITY_NAME_MAX)
  name: string;

  @ApiPropertyOptional({
    example: 'Mummies room',
    maxLength: ACTIVITY_DESCRIPTION_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ACTIVITY_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({
    example: '09:30',
    description: 'Optional, 24-hour HH:mm.',
  })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'time must be HH:mm (24-hour)' })
  time?: string | null;

  @ApiPropertyOptional({
    example: 450,
    description:
      'Optional cost (0 or more, at most 2 decimals). Needs currency.',
  })
  @IsOptional()
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  cost?: number | null;

  @ApiPropertyOptional({
    example: 'EGP',
    description: 'Supported currency code.',
  })
  @IsOptional()
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency?: string | null;
}

/** Every field optional; send null for time or cost to clear it. */
export class UpdateActivityDto {
  @ApiPropertyOptional({
    example: 'Egyptian Museum (GEM)',
    maxLength: ACTIVITY_NAME_MAX,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, ACTIVITY_NAME_MAX)
  name?: string;

  @ApiPropertyOptional({ maxLength: ACTIVITY_DESCRIPTION_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ACTIVITY_DESCRIPTION_MAX)
  description?: string;

  @ApiPropertyOptional({ example: '10:00', nullable: true })
  @IsOptional()
  @Matches(TIME_PATTERN, { message: 'time must be HH:mm (24-hour)' })
  time?: string | null;

  @ApiPropertyOptional({ example: 500, nullable: true })
  @IsOptional()
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  cost?: number | null;

  @ApiPropertyOptional({ example: 'EGP', nullable: true })
  @IsOptional()
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency?: string | null;
}

// ---------------------------------------------------------------- budget

export class CreateBudgetEntryDto {
  @ApiProperty({ enum: BUDGET_CATEGORIES, example: 'food' })
  @IsIn(BUDGET_CATEGORIES)
  category: BudgetCategory;

  @ApiProperty({ example: 350, description: '0 or more, at most 2 decimals.' })
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: 'EGP', description: 'Supported currency code.' })
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency: string;

  @ApiPropertyOptional({
    example: 'Dinner on the Nile',
    maxLength: ENTRY_NOTE_MAX,
  })
  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_NOTE_MAX)
  note?: string;
}

export class UpdateBudgetEntryDto {
  @ApiPropertyOptional({ enum: BUDGET_CATEGORIES })
  @IsOptional()
  @IsIn(BUDGET_CATEGORIES)
  category?: BudgetCategory;

  @ApiPropertyOptional({ example: 400 })
  @IsOptional()
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency?: string;

  @ApiPropertyOptional({ maxLength: ENTRY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_NOTE_MAX)
  note?: string;
}

// ------------------------------------------------------------- transport

export class CreateTransportEntryDto {
  @ApiProperty({
    example: '6650f1c2a1b2c3d4e5f60718',
    description: 'The day it belongs to.',
  })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ enum: TRANSPORT_MODES, example: 'train' })
  @IsIn(TRANSPORT_MODES)
  mode: TransportMode;

  @ApiProperty({ example: 'cairo' })
  @IsString()
  @Length(1, CITY_ID_MAX)
  fromCityId: string;

  @ApiProperty({ example: 'luxor' })
  @IsString()
  @Length(1, CITY_ID_MAX)
  toCityId: string;

  @ApiProperty({ example: 900 })
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount: number;

  @ApiProperty({ example: 'EGP' })
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency: string;

  @ApiPropertyOptional({ example: 'Sleeper train', maxLength: ENTRY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_NOTE_MAX)
  note?: string;
}

export class UpdateTransportEntryDto {
  @ApiPropertyOptional({ example: '6650f1c2a1b2c3d4e5f60718' })
  @IsOptional()
  @IsMongoId()
  dayId?: string;

  @ApiPropertyOptional({ enum: TRANSPORT_MODES })
  @IsOptional()
  @IsIn(TRANSPORT_MODES)
  mode?: TransportMode;

  @ApiPropertyOptional({ example: 'cairo' })
  @IsOptional()
  @IsString()
  @Length(1, CITY_ID_MAX)
  fromCityId?: string;

  @ApiPropertyOptional({ example: 'aswan' })
  @IsOptional()
  @IsString()
  @Length(1, CITY_ID_MAX)
  toCityId?: string;

  @ApiPropertyOptional({ example: 950 })
  @IsOptional()
  @Amount()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;

  @ApiPropertyOptional({ example: 'EGP' })
  @IsOptional()
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency?: string;

  @ApiPropertyOptional({ maxLength: ENTRY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(ENTRY_NOTE_MAX)
  note?: string;
}

// ------------------------------------------------------------ conversion

/** ITN-18: optional display currency for converted amounts. */
export class CurrencyQueryDto {
  @ApiPropertyOptional({
    example: 'EGP',
    description:
      'Supported currency to convert to. Default: your preferred currency, else USD.',
  })
  @IsOptional()
  @Matches(CURRENCY_PATTERN, {
    message: 'currency must be a 3-letter code like EGP',
  })
  currency?: string;
}

// ---------------------------------------------------------------- search

/** ITN-21 public search. */
export class SearchItinerariesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    example: 'nile',
    description: 'Matches the title, a country (name or code) or a city name.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX)
  q?: string;

  @ApiPropertyOptional({ example: 'EG', description: 'Country code.' })
  @IsOptional()
  @Matches(COUNTRY_CODE_PATTERN, {
    message: 'country must be a 2-letter code like EG',
  })
  country?: string;

  @ApiPropertyOptional({
    example: 'luxor',
    description: 'City id: at least one day there.',
  })
  @IsOptional()
  @IsString()
  @Length(1, CITY_ID_MAX)
  cityId?: string;

  @ApiPropertyOptional({ example: 3, minimum: 0, maximum: MAX_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  minDays?: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, maximum: MAX_DAYS })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  maxDays?: number;
}
