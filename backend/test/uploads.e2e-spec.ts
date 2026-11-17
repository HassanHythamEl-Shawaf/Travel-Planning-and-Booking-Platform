/**
 * Upload module e2e (GEN-08) over real HTTP: the 5 MB multer limit, type
 * checks, and serving files by URL. Uses a small app with only the uploads
 * module and a test route, an in-memory MongoDB and a temporary folder. It
 * never touches Atlas or reads .env.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Controller,
  INestApplication,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection } from 'mongoose';
import request from 'supertest';

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ImageFileInterceptor } from '../src/uploads/image-file.interceptor';
import {
  MAX_IMAGE_BYTES,
  UPLOAD_ERRORS,
} from '../src/uploads/uploads.constants';
import { UploadsModule } from '../src/uploads/uploads.module';
import { UploadsService } from '../src/uploads/uploads.service';
import { JPEG_BYTES, jpegOfSize, PNG_BYTES } from './fixtures/images';

jest.setTimeout(180_000);

/** A test-only route that uploads one image the way real modules do. */
@Controller('test-images')
class TestImageController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseInterceptors(ImageFileInterceptor('file'))
  upload(@UploadedFile() file: unknown) {
    return this.uploads.upload(file, { type: 'activity', id: 'e2e' });
  }
}

describe('Uploads (e2e, GEN-08)', () => {
  let mongo: MongoMemoryServer;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let dir: string;

  const upload = (buffer: Buffer, name = 'photo.jpg') =>
    request(server).post('/api/test-images').attach('file', buffer, name);

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    dir = mkdtempSync(join(tmpdir(), 'uploads-e2e-'));
    process.env.UPLOAD_DIR = dir;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        MongooseModule.forRoot(mongo.getUri('uploads-e2e')),
        UploadsModule,
      ],
      controllers: [TestImageController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    server = app.getHttpServer();
    connection = app.get<Connection>(getConnectionToken());
    expect(connection.host).toBe('127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    delete process.env.UPLOAD_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('stores a JPG and serves it by URL with its real content type', async () => {
    const res = await upload(JPEG_BYTES).expect(201);
    expect(res.body).toMatchObject({
      mimeType: 'image/jpeg',
      size: JPEG_BYTES.length,
    });
    expect(res.body.url).toMatch(/^\/api\/uploads\/[0-9a-f-]{36}\.jpg$/);

    const served = await request(server).get(res.body.url).expect(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(served.body)).toEqual(JPEG_BYTES);
  });

  it('stores a PNG even if the client calls it something else', async () => {
    const res = await upload(PNG_BYTES, 'notes.txt').expect(201);
    expect(res.body.url).toMatch(/\.png$/);
    const served = await request(server).get(res.body.url).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
  });

  it('accepts exactly 5 MB and rejects anything bigger with 400 (not 413)', async () => {
    await upload(jpegOfSize(MAX_IMAGE_BYTES)).expect(201);
    const res = await upload(jpegOfSize(MAX_IMAGE_BYTES + 1)).expect(400);
    expect(res.body.message).toBe(UPLOAD_ERRORS.tooLarge);
  });

  it('rejects other file types and a missing file with 400', async () => {
    const gif = await upload(Buffer.from('GIF89a......'), 'cat.jpg').expect(
      400,
    );
    expect(gif.body.message).toBe(UPLOAD_ERRORS.wrongType);
    const missing = await request(server).post('/api/test-images').expect(400);
    expect(missing.body.message).toBe(UPLOAD_ERRORS.missing);
  });

  it('serves only stored files', async () => {
    await request(server).get('/api/uploads/does-not-exist.jpg').expect(404);
    await request(server).get('/api/uploads/..%2F..%2F.env').expect(404);
    await request(server)
      .get('/api/uploads/00000000-0000-0000-0000-000000000000.jpg')
      .expect(404);
  });

  it('gives parallel uploads their own files and records', async () => {
    const before = readdirSync(dir).length;
    const results = await Promise.all(
      Array.from({ length: 10 }, () => upload(JPEG_BYTES)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    const names = new Set(results.map((r) => r.body.fileName as string));
    expect(names.size).toBe(10);
    expect(readdirSync(dir).length).toBe(before + 10);
    expect(
      await connection.collection('uploads').countDocuments({ ownerId: 'e2e' }),
    ).toBe(readdirSync(dir).length);
  });
});
