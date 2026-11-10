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

import {
  PROVIDER_ASSIGNMENT_READER,
  ProviderAssignmentReader,
} from '../auth/provider-assignment.reader';
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
import { CreateFlightDto, FlightResponseDto } from './dto/flight.dto';
import { Airline } from './schemas/airline.schema';
import { Flight } from './schemas/flight.schema';

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
        departureLocalDate: departureLocal.toISODate(),
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
