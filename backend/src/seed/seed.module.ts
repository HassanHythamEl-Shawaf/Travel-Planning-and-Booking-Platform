import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { SeedService } from './seed.service';

// Standalone module for `npm run seed`. It deliberately does not import
// AppModule, so auth guards and HTTP controllers are not booted.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),
    ReferenceDataModule,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
