/**
 * Airline logo (FLT-01) and hotel photos (HTL-01) through the shared upload
 * module (GEN-08), over HTTP. Boots the whole AppModule against an in-memory
 * MongoDB replica set and a temporary upload folder; never Atlas, never
 * real secrets.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { JPEG_BYTES, jpegOfSize, PNG_BYTES } from './fixtures/images';

jest.setTimeout(180_000);

describe('Airline logo and hotel photos (e2e, GEN-08)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let uploadDir: string;
  let admin: TestAgent;
  let traveller: TestAgent;
  let airlineModerator: TestAgent;
  let hotelModerator: TestAgent;
  let airlineId: string;
  let hotelId: string;

  const PASSWORD = 'Password123';

  const login = async (email: string, password = PASSWORD) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(201);
    return agent;
  };

  const insertUser = async (email: string, role: 'admin' | 'user') => {
    const now = new Date();
    await connection.collection('users').insertOne({
      name: role === 'admin' ? 'E2E Admin' : 'Sara Traveller',
      email,
      passwordHash: await bcrypt.hash(PASSWORD, 4),
      role,
      status: 'active',
      termsAcceptedAt: now,
      privacyPolicyAcceptedAt: now,
      failedLoginAttempts: 0,
      lockUntil: null,
      refreshTokenHash: null,
      lastActivityAt: null,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    });
  };

  /** Admin creates a provider moderator; they set a password and log in. */
  const createModerator = async (
    email: string,
    providerType: 'airline' | 'hotel',
    providerId: string,
  ) => {
    await admin
      .post('/api/admin/moderators')
      .send({
        name: `${providerType} moderator`,
        email,
        temporaryPassword: 'temp',
        providerType,
        providerId,
      })
      .expect(201);
    const firstLogin = await login(email, 'temp');
    await firstLogin
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'temp', newPassword: PASSWORD })
      .expect(200);
    return login(email);
  };

  const files = () => readdirSync(uploadDir);
  const uploadsFor = (ownerType: string, ownerId: string) =>
    connection.collection('uploads').countDocuments({ ownerType, ownerId });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('e2e-provider-images');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';
    // PaymentsModule needs a Stripe key to start; never a real one in tests.
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder_not_real';
    uploadDir = mkdtempSync(join(tmpdir(), 'provider-images-e2e-'));
    process.env.UPLOAD_DIR = uploadDir;

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    server = app.getHttpServer();

    connection = app.get<Connection>(getConnectionToken());
    expect(connection.host).toBe('127.0.0.1');
    await Promise.all(
      Object.values(connection.models).map((m) => m.syncIndexes()),
    );

    await insertUser('admin@e2e.test', 'admin');
    await insertUser('sara@e2e.test', 'user');
    const airline = await connection.collection('airlines').insertOne({
      name: 'Nile Air',
      code: 'NA',
      isActive: true,
      logoUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    airlineId = airline.insertedId.toString();
    const hotel = await connection.collection('hotels').insertOne({
      name: 'Nile View Hotel',
      description: 'On the corniche',
      address: '1 Corniche St',
      city: 'Aswan',
      country: 'Egypt',
      photos: [],
      isActive: true,
    });
    hotelId = hotel.insertedId.toString();

    admin = await login('admin@e2e.test');
    traveller = await login('sara@e2e.test');
    airlineModerator = await createModerator(
      'air@e2e.test',
      'airline',
      airlineId,
    );
    hotelModerator = await createModerator('hotel@e2e.test', 'hotel', hotelId);
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
    delete process.env.UPLOAD_DIR;
    rmSync(uploadDir, { recursive: true, force: true });
  });

  describe('airline logo (FLT-01)', () => {
    const logo = () => `/api/airlines/${airlineId}/logo`;

    it('lets the assigned moderator upload, replace and remove the logo', async () => {
      const first = await airlineModerator
        .put(logo())
        .attach('file', JPEG_BYTES, 'logo.jpg')
        .expect(200);
      expect(first.body.logoUrl).toMatch(
        /^\/api\/uploads\/[0-9a-f-]{36}\.jpg$/,
      );
      await request(server).get(first.body.logoUrl).expect(200);

      // One logo per airline: the new one replaces the old file.
      const second = await airlineModerator
        .put(logo())
        .attach('file', PNG_BYTES, 'logo.png')
        .expect(200);
      expect(second.body.logoUrl).toMatch(/\.png$/);
      await request(server).get(first.body.logoUrl).expect(404);
      expect(await uploadsFor('airline', airlineId)).toBe(1);

      const profile = await request(server)
        .get(`/api/airlines/${airlineId}`)
        .expect(200);
      expect(profile.body.logoUrl).toBe(second.body.logoUrl);

      const removed = await airlineModerator.delete(logo()).expect(200);
      expect(removed.body.logoUrl).toBeNull();
      await request(server).get(second.body.logoUrl).expect(404);
      expect(await uploadsFor('airline', airlineId)).toBe(0);
    });

    it('rejects bad files, direct URLs and other users', async () => {
      const notImage = await airlineModerator
        .put(logo())
        .attach('file', Buffer.from('GIF89a......'), 'logo.jpg')
        .expect(400);
      expect(notImage.body.message).toBe('Only JPG or PNG images are allowed');
      const tooBig = await airlineModerator
        .put(logo())
        .attach('file', jpegOfSize(5 * 1024 * 1024 + 1), 'logo.jpg')
        .expect(400);
      expect(tooBig.body.message).toBe('Images can be at most 5 MB');
      await airlineModerator.put(logo()).expect(400);

      await airlineModerator
        .patch(`/api/airlines/${airlineId}`)
        .send({ logoUrl: 'https://example.com/logo.png' })
        .expect(400);

      await request(server)
        .put(logo())
        .attach('file', JPEG_BYTES, 'logo.jpg')
        .expect(401);
      await traveller
        .put(logo())
        .attach('file', JPEG_BYTES, 'logo.jpg')
        .expect(403);
      await hotelModerator
        .put(logo())
        .attach('file', JPEG_BYTES, 'logo.jpg')
        .expect(403);
      expect(await uploadsFor('airline', airlineId)).toBe(0);
    });
  });

  describe('hotel photos (HTL-01)', () => {
    const photos = () => `/api/hotels/${hotelId}/photos`;

    it('keeps at most 5 photos under parallel uploads and deletes the extra files', async () => {
      const before = files().length;
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          hotelModerator.post(photos()).attach('file', JPEG_BYTES, 'room.jpg'),
        ),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 201, 201, 201, 201, 400, 400, 400]);

      const hotel = await connection.collection('hotels').findOne({});
      expect(hotel!.photos).toHaveLength(5);
      expect(await uploadsFor('hotel', hotelId)).toBe(5);
      expect(files().length).toBe(before + 5);

      const sixth = await hotelModerator
        .post(photos())
        .attach('file', JPEG_BYTES, 'room.jpg')
        .expect(400);
      expect(sixth.body.message).toBe('A hotel can have at most 5 photos');
    });

    it('removes a photo and its file', async () => {
      const hotel = await connection.collection('hotels').findOne({});
      const url = (hotel!.photos as string[])[0];
      const fileName = url.split('/').pop();

      const res = await hotelModerator
        .delete(`${photos()}/${fileName}`)
        .expect(200);
      expect(res.body.photos).toHaveLength(4);
      expect(res.body.photos).not.toContain(url);
      await request(server).get(url).expect(404);
      await hotelModerator.delete(`${photos()}/${fileName}`).expect(404);
    });

    it("never deletes another item's file through a copied URL", async () => {
      // POST /api/hotels accepts photo URL strings, so a hotel could list an
      // image that belongs to something else (here: the airline's logo).
      const logo = await airlineModerator
        .put(`/api/airlines/${airlineId}/logo`)
        .attach('file', JPEG_BYTES, 'logo.jpg')
        .expect(200);
      await connection
        .collection('hotels')
        .updateOne({}, { $push: { photos: logo.body.logoUrl } });

      const fileName = (logo.body.logoUrl as string).split('/').pop();
      await hotelModerator.delete(`${photos()}/${fileName}`).expect(200);
      // The reference is gone from the hotel, but the airline's file stays.
      await request(server).get(logo.body.logoUrl).expect(200);
      expect(await uploadsFor('airline', airlineId)).toBe(1);

      await airlineModerator.delete(`/api/airlines/${airlineId}/logo`).expect(200);
    });

    it('allows only the assigned hotel moderator', async () => {
      await request(server)
        .post(photos())
        .attach('file', JPEG_BYTES, 'room.jpg')
        .expect(401);
      await traveller
        .post(photos())
        .attach('file', JPEG_BYTES, 'room.jpg')
        .expect(403);
      await airlineModerator
        .post(photos())
        .attach('file', JPEG_BYTES, 'room.jpg')
        .expect(403);
      const hotel = await connection.collection('hotels').findOne({});
      const fileName = (hotel!.photos as string[])[0].split('/').pop();
      await airlineModerator.delete(`${photos()}/${fileName}`).expect(403);
      expect(await uploadsFor('hotel', hotelId)).toBe(4);
    });
  });
});
