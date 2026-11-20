import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataController } from './reference-data.controller';
import { ReferenceDataService } from './reference-data.service';
import { Airport, AirportSchema } from './schemas/airport.schema';
import { Attraction, AttractionSchema } from './schemas/attraction.schema';
import { City, CitySchema } from './schemas/city.schema';
import { Country, CountrySchema } from './schemas/country.schema';
import { Currency, CurrencySchema } from './schemas/currency.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Country.name, schema: CountrySchema },
      { name: City.name, schema: CitySchema },
      { name: Airport.name, schema: AirportSchema },
      { name: Attraction.name, schema: AttractionSchema },
      { name: Currency.name, schema: CurrencySchema },
    ]),
  ],
  controllers: [ReferenceDataController],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService, MongooseModule],
})
export class ReferenceDataModule {}
