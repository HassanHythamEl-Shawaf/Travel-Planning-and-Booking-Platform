import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { getPagination } from '../common/pagination';

import {
  PROVIDER_ASSIGNMENT_READER,
} from '../auth/provider-assignment.reader';
import type { ProviderAssignmentReader } from '../auth/provider-assignment.reader';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import {
  AIRLINE_LOGO_STORE,
  AirlineLogoStore,
} from './airline-logo-store';
import {
  AirlineResponseDto,
  CreateAirlineDto,
  UpdateAirlineDto,
} from './dto/airline.dto';
import { AirportResponseDto } from './dto/airport.dto';
import {
  BaggagePolicyResponseDto,
  UpdateBaggagePolicyDto,
} from './dto/baggage-policy.dto';
import {
  CancellationPolicyResponseDto,
  UpdateCancellationPolicyDto,
} from './dto/cancellation-policy.dto';
import { CreateFlightDto, FlightResponseDto } from './dto/flight.dto';
import {
  CabinResponseDto,
  CreateCabinDto,
  UpdateCabinDto,
} from './dto/cabin.dto';
import { Airline } from './schemas/airline.schema';
import { CabinCategory, Flight, FlightStatus } from './schemas/flight.schema';
import { FlightStatusResponseDto } from './dto/flight-status.dto';
import {
  FlightSearchResponseDto,
  FlightSearchResultDto,
  SearchFlightsDto,
} from './dto/flight-search.dto';

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

@Injectable()
export class AirlinesService {
  constructor(
    @InjectModel(Airline.name)
    private readonly airlineModel: Model<Airline>,
    @InjectModel(Flight.name)
    private readonly flightModel: Model<Flight>,
    @Optional()
    @Inject(AIRLINE_LOGO_STORE)
    private readonly logoStore?: AirlineLogoStore | null,
    private readonly referenceData?: ReferenceDataService,
    @Inject(PROVIDER_ASSIGNMENT_READER)
    private readonly assignments?: ProviderAssignmentReader,
  ) {}

  async create(dto: CreateAirlineDto): Promise<AirlineResponseDto> {
    this.rejectDirectLogoUrl(dto.logoUrl);

    try {
      const airline = await this.airlineModel.create({
        name: dto.name,
        code: dto.code,
        isActive: true,
        logoUrl: null,
      });
      return this.toResponse(airline);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An airline with this code already exists');
      }

      throw error;
    }
  }

  async listAirports(): Promise<AirportResponseDto[]> {
    if (!this.referenceData) {
      throw new NotImplementedException(
        'Airport reference data is not configured',
      );
    }

    const result = await this.referenceData.listAirports();
    return result.items.map((airport) => ({
      iataCode: airport._id,
      name: airport.name,
      city: airport.cityId,
      country: airport.countryCode,
      timeZone: airport.timeZone,
    }));
  }

  async createFlight(
    moderatorId: string,
    dto: CreateFlightDto,
  ): Promise<FlightResponseDto> {
    if (!this.assignments) {
      throw new NotImplementedException(
        'Moderator assignment integration is not configured',
      );
    }

    const assignment = await this.assignments.findByModeratorId(moderatorId);
    if (
      !assignment ||
      assignment.providerType !== 'airline' ||
      assignment.providerId !== dto.airlineId
    ) {
      throw new NotFoundException('Assigned airline not found');
    }

    if (!this.referenceData) {
      throw new NotImplementedException(
        'Airport reference data is not configured',
      );
    }


    const [airline, departureAirport, arrivalAirport] = await Promise.all([
      this.airlineModel.findById(dto.airlineId).lean().exec(),
      this.referenceData.findAirport(dto.departureAirportCode),
      this.referenceData.findAirport(dto.arrivalAirportCode),
    ]);
    if (!airline) throw new NotFoundException('Airline not found');
    if (!departureAirport || !arrivalAirport) {
      throw new NotFoundException('Both airports must be seeded airports');
    }
    if (dto.departureAirportCode === dto.arrivalAirportCode) {
      throw new ConflictException('Departure and arrival airports must differ');
    }

    const departureLocal = this.parseLocalDateTime(
      dto.departureLocalTime,
      departureAirport.timeZone,
    );
    const arrivalLocal = this.parseLocalDateTime(
      dto.arrivalLocalTime,
      arrivalAirport.timeZone,
    );
    if (departureLocal.toMillis() <= Date.now()) {
      throw new ConflictException('Departure must be in the future');
    }
    if (arrivalLocal.toMillis() <= departureLocal.toMillis()) {
      throw new ConflictException('Arrival must be after departure');
    }
    const departureLocalDate = departureLocal.toISODate();
    if (!departureLocalDate) {
      throw new ConflictException('Departure date is invalid');
    }

    try {
      const flight = await this.flightModel.create({
        airlineId: dto.airlineId,
        flightNumber: dto.flightNumber,
        departureAirportCode: dto.departureAirportCode,
        arrivalAirportCode: dto.arrivalAirportCode,
        departureAt: departureLocal.toUTC().toJSDate(),
        arrivalAt: arrivalLocal.toUTC().toJSDate(),
        departureTimeZone: departureAirport.timeZone,
        arrivalTimeZone: arrivalAirport.timeZone,
        departureLocalDate,
      });
      return this.toFlightResponse(flight);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          'Flight number already exists for this airline and departure date',
        );
      }
      throw error;
    }
  }

  async getFlightStatus(
    flightId: string,
    now = new Date(),
  ): Promise<FlightStatusResponseDto> {
    const flight = await this.flightModel.findById(flightId).lean().exec();
    if (!flight) throw new NotFoundException('Flight not found');
    if (flight.status === FlightStatus.CANCELLED) {
      return { status: FlightStatus.CANCELLED };
    }

    return {
      status:
        new Date(flight.departureAt).getTime() <= now.getTime()
          ? FlightStatus.DEPARTED
          : FlightStatus.SCHEDULED,
    };
  }

  async searchFlights(
    dto: SearchFlightsDto,
  ): Promise<FlightSearchResponseDto> {
    if (
      dto.minPrice !== undefined &&
      dto.maxPrice !== undefined &&
      dto.minPrice > dto.maxPrice
    ) {
      throw new ConflictException('Minimum price must not exceed maximum price');
    }
    const adults = dto.adults ?? dto.passengers ?? 0;
    const children = dto.children ?? 0;
    const infants = dto.infants ?? 0;
    if (adults < 1) {
      throw new ConflictException('At least one adult is required');
    }
    if (infants > adults) {
      throw new ConflictException('Infants cannot exceed adults');
    }
    if (dto.tripType === 'round-trip' && !dto.returnDate) {
      throw new ConflictException('Return date is required for round trips');
    }
    if (dto.returnDate && dto.returnDate < dto.departureDate) {
      throw new ConflictException('Return date must not be before departure date');
    }
    if (!this.referenceData) {
      throw new NotImplementedException(
        'Airport reference data is not configured',
      );
    }
    const [departureAirport, arrivalAirport] = await Promise.all([
      this.referenceData.findAirport(dto.departureAirportCode),
      this.referenceData.findAirport(dto.arrivalAirportCode),
    ]);
    if (!departureAirport || !arrivalAirport) {
      throw new NotFoundException('Both airports must be seeded airports');
    }
    const airlines = await this.airlineModel
      .find({ isActive: { $ne: false } })
      .select({ _id: 1 })
      .lean()
      .exec();
    const airlineIds = airlines.map((airline) => airline._id);
    const items = await this.findSearchFlights(
      dto.departureAirportCode,
      dto.arrivalAirportCode,
      dto.departureDate,
      adults + children,
      dto.cabinClass,
      airlineIds,
      dto.minPrice,
      dto.maxPrice,
      dto.sort,
    );
    const returnItems = dto.returnDate
      ? await this.findSearchFlights(
          dto.arrivalAirportCode,
          dto.departureAirportCode,
          dto.returnDate,
          adults + children,
          dto.cabinClass,
          airlineIds,
          dto.minPrice,
          dto.maxPrice,
          dto.sort,
        )
      : undefined;
    const pagination = getPagination(dto.page ?? 1);
    const total = items.length;
    const pagedItems = items.slice(
      pagination.skip,
      pagination.skip + pagination.limit,
    );
    return {
      items: pagedItems,
      returnItems: returnItems?.slice(
        pagination.skip,
        pagination.skip + pagination.limit,
      ),
      page: pagination.page,
      limit: pagination.limit,
      total,
      totalPages: Math.ceil(total / pagination.limit),
      message:
        items.length === 0 || (returnItems && returnItems.length === 0)
          ? 'No flights found'
          : 'Flights found',
    };
  }

  private async findSearchFlights(
    departureAirportCode: string,
    arrivalAirportCode: string,
    departureDate: string,
    requiredSeats: number,
    cabinClass: string | undefined,
    airlineIds: Types.ObjectId[],
    minPrice: number | undefined,
    maxPrice: number | undefined,
    sort: 'price' | 'duration' | 'departure' | undefined,
  ): Promise<FlightSearchResultDto[]> {
    const flights = await this.flightModel
      .find({
        airlineId: { $in: airlineIds },
        departureAirportCode,
        arrivalAirportCode,
        departureLocalDate: departureDate.slice(0, 10),
        status: FlightStatus.SCHEDULED,
      })
      .sort({ departureAt: 1 })
      .lean()
      .exec();
    return flights
      .map((flight) => this.toSearchResult(flight))
      .map((flight) => ({
        ...flight,
        cabins: flight.cabins.filter(
          (cabin) =>
            (!cabinClass || cabin.category === cabinClass) &&
            (minPrice === undefined || cabin.price >= minPrice) &&
            (maxPrice === undefined || cabin.price <= maxPrice),
        ),
      }))
      .filter((flight) =>
        flight.cabins.some((cabin) => cabin.seatsAvailable >= requiredSeats),
      )
      .sort((left, right) => {
        if (sort === 'price') {
          return (
            Math.min(...left.cabins.map((cabin) => cabin.price)) -
            Math.min(...right.cabins.map((cabin) => cabin.price))
          );
        }
        if (sort === 'duration') {
          return left.durationMinutes - right.durationMinutes;
        }
        return left.departureAt.getTime() - right.departureAt.getTime();
      });
  }

  async addCabin(
    moderatorId: string,
    flightId: string,
    dto: CreateCabinDto,
  ): Promise<CabinResponseDto> {
    const flight = await this.getOwnedFlight(moderatorId, flightId);
    if (flight.cabins.some((cabin) => cabin.category === dto.category)) {
      throw new ConflictException(
        'Each cabin category may be used once per flight',
      );
    }
    flight.cabins.push(dto);
    await flight.save();
    return this.toCabinResponse(flight.cabins[flight.cabins.length - 1]);
  }

  async updateCabin(
    moderatorId: string,
    flightId: string,
    cabinId: string,
    dto: UpdateCabinDto,
  ): Promise<CabinResponseDto> {
    const flight = await this.getOwnedFlight(moderatorId, flightId);
    if (!Types.ObjectId.isValid(cabinId)) {
      throw new NotFoundException('Cabin not found');
    }
    const cabin = flight.cabins.find(
      (candidate) => String(candidate._id) === cabinId,
    );
    if (!cabin) throw new NotFoundException('Cabin not found');
    Object.assign(cabin, dto);
    await flight.save();
    return this.toCabinResponse(cabin);
  }

  async findOne(id: string): Promise<AirlineResponseDto> {
    const airline = await this.airlineModel.findById(id).lean().exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return this.toResponse(airline);
  }

  async update(
    id: string,
    dto: UpdateAirlineDto,
  ): Promise<AirlineResponseDto> {
    this.rejectDirectLogoUrl(dto.logoUrl);

    if (
      dto.name === undefined &&
      dto.code === undefined &&
      dto.logoUrl === undefined
    ) {
      throw new ConflictException('At least one airline field is required');
    }

    try {
      const airline = await this.airlineModel
        .findByIdAndUpdate(
          id,
          {
            ...(dto.name !== undefined && { name: dto.name }),
            ...(dto.code !== undefined && { code: dto.code }),
          },
          { returnDocument: 'after', runValidators: true },
        )
        .lean()
        .exec();
      if (!airline) throw new NotFoundException('Airline not found');
      return this.toResponse(airline);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('An airline with this code already exists');
      }

      throw error;
    }
  }

  async updateBaggagePolicy(
    id: string,
    dto: UpdateBaggagePolicyDto,
  ): Promise<BaggagePolicyResponseDto> {
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        id,
        { $set: { baggagePolicy: dto } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return {
      pricePerExtraBag: dto.pricePerExtraBag,
      maxExtraBagsPerPassenger: dto.maxExtraBagsPerPassenger,
    };
  }

  async updateCancellationPolicy(
    id: string,
    dto: UpdateCancellationPolicyDto,
  ): Promise<CancellationPolicyResponseDto> {
    const thresholds = dto.tiers.map((tier) => tier.daysBeforeDeparture);
    if (new Set(thresholds).size !== thresholds.length) {
      throw new ConflictException('Cancellation thresholds must be unique');
    }
    const tiers = [...dto.tiers].sort(
      (left, right) => right.daysBeforeDeparture - left.daysBeforeDeparture,
    );
    const airline = await this.airlineModel
      .findByIdAndUpdate(
        id,
        { $set: { cancellationPolicy: tiers } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    if (!airline) throw new NotFoundException('Airline not found');
    return { tiers };
  }

  private rejectDirectLogoUrl(logoUrl: string | undefined): void {
    if (logoUrl === undefined) return;
    if (!this.logoStore) {
      throw new NotImplementedException(
        'Airline logos require Person 8 image-upload integration',
      );
    }

  }

  private parseLocalDateTime(value: string, zone: string): DateTime {
    if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
      throw new ConflictException(
        'Flight date-times must be entered as local times without an offset',
      );
    }

    const parsed = DateTime.fromISO(value, { zone });
    if (!parsed.isValid) {
      throw new ConflictException(
        `Invalid local date-time: ${parsed.invalidReason}`,
      );
    }
    return parsed;
  }

  private async getOwnedFlight(
    moderatorId: string,
    flightId: string,
  ): Promise<Flight & { save: () => Promise<unknown> }> {
    if (!this.assignments) {
      throw new NotImplementedException(
        'Moderator assignment integration is not configured',
      );
    }
    const flight = await this.flightModel.findById(flightId).exec();
    if (!flight) throw new NotFoundException('Flight not found');
    const assignment = await this.assignments.findByModeratorId(moderatorId);
    if (
      !assignment ||
      assignment.providerType !== 'airline' ||
      assignment.providerId !== String(flight.airlineId)
    ) {
      throw new NotFoundException('Flight not found');
    }
    return flight as Flight & { save: () => Promise<unknown> };
  }

  private toCabinResponse(cabin: {
    _id?: unknown;
    category: CabinCategory;
    seatCount: number;
    price: number;
    freeBaggageAllowance: number;
    maxWeightPerBagKg: number;
  }): CabinResponseDto {
    return {
      id: String(cabin._id),
      category: cabin.category,
      seatCount: cabin.seatCount,
      price: cabin.price,
      freeBaggageAllowance: cabin.freeBaggageAllowance,
      maxWeightPerBagKg: cabin.maxWeightPerBagKg,
    };
  }

  private toFlightResponse(flight: {
    _id: unknown;
    airlineId: unknown;
    flightNumber: string;
    departureAirportCode: string;
    arrivalAirportCode: string;
    departureAt: Date;
    arrivalAt: Date;
    departureTimeZone: string;
    arrivalTimeZone: string;
    departureLocalDate: string;
    status?: FlightStatus;
  }): FlightResponseDto {
    return {
      id: String(flight._id),
      airlineId: String(flight.airlineId),
      flightNumber: flight.flightNumber,
      departureAirportCode: flight.departureAirportCode,
      arrivalAirportCode: flight.arrivalAirportCode,
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      departureTimeZone: flight.departureTimeZone,
      arrivalTimeZone: flight.arrivalTimeZone,
      departureLocalDate: flight.departureLocalDate,
      status:
        flight.status === FlightStatus.CANCELLED
          ? FlightStatus.CANCELLED
          : new Date(flight.departureAt).getTime() <= Date.now()
            ? FlightStatus.DEPARTED
            : FlightStatus.SCHEDULED,
    };
  }

  private toSearchResult(flight: {
    _id: unknown;
    flightNumber: string;
    departureAirportCode: string;
    arrivalAirportCode: string;
    departureAt: Date;
    arrivalAt: Date;
    departureTimeZone: string;
    arrivalTimeZone: string;
    cabins: Array<{
      _id?: unknown;
      category: CabinCategory;
      price: number;
      seatCount: number;
      seatsBooked?: number;
      seatsHeld?: number;
      freeBaggageAllowance: number;
      maxWeightPerBagKg: number;
    }>;
  }): FlightSearchResultDto {
    return {
      id: String(flight._id),
      flightNumber: flight.flightNumber,
      departureAirportCode: flight.departureAirportCode,
      arrivalAirportCode: flight.arrivalAirportCode,
      departureAt: flight.departureAt,
      arrivalAt: flight.arrivalAt,
      departureTimeZone: flight.departureTimeZone,
      arrivalTimeZone: flight.arrivalTimeZone,
      durationMinutes:
        (new Date(flight.arrivalAt).getTime() -
          new Date(flight.departureAt).getTime()) /
        60000,
      cabins: flight.cabins.map((cabin) => ({
        id: String(cabin._id),
        category: cabin.category,
        price: cabin.price,
        infantPrice: cabin.price * 0.1,
        seatsAvailable:
          cabin.seatCount - (cabin.seatsBooked ?? 0) - (cabin.seatsHeld ?? 0),
        freeBaggageAllowance: cabin.freeBaggageAllowance,
        maxWeightPerBagKg: cabin.maxWeightPerBagKg,
      })),
    };
  }

  private toResponse(airline: {
    _id: unknown;
    name: string;
    code: string;
    logoUrl: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): AirlineResponseDto {
    return {
      id: String(airline._id),
      name: airline.name,
      code: airline.code,
      logoUrl: airline.logoUrl ?? null,
      isActive: airline.isActive,
      createdAt: airline.createdAt,
      updatedAt: airline.updatedAt,
    };
  }
}
