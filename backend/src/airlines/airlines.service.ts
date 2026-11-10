import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

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
import { Airline } from './schemas/airline.schema';

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
    @Optional()
    @Inject(AIRLINE_LOGO_STORE)
    private readonly logoStore?: AirlineLogoStore | null,
    private readonly referenceData?: ReferenceDataService,
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
