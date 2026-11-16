import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Connection, Model, Types } from 'mongoose';

import { JPEG_BYTES, jpegOfSize, PNG_BYTES } from '../../test/fixtures/images';
import { Upload, UploadSchema } from './schemas/upload.schema';
import { MAX_IMAGE_BYTES, UPLOAD_ERRORS } from './uploads.constants';
import { UploadsService } from './uploads.service';

jest.setTimeout(120_000);

const file = (buffer: Buffer, mimetype = 'image/jpeg', name = 'photo.jpg') => ({
  originalname: name,
  mimetype,
  size: buffer.length,
  buffer,
});

/** GEN-08 against a real (in-memory) MongoDB and a temporary folder. */
describe('UploadsService (GEN-08)', () => {
  let server: MongoMemoryServer;
  let connection: Connection;
  let model: Model<Upload>;
  let dir: string;
  let service: UploadsService;
  const post = { type: 'post' as const, id: new Types.ObjectId().toString() };

  const filesOnDisk = () => (existsSync(dir) ? readdirSync(dir) : []);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await mongoose
      .createConnection(server.getUri(), { dbName: 'uploads' })
      .asPromise();
    model = connection.model(
      Upload.name,
      UploadSchema,
    ) as unknown as Model<Upload>;
    await model.syncIndexes();
  });

  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'uploads-spec-'));
    const config = { get: () => dir } as unknown as ConfigService;
    service = new UploadsService(model, config);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await model.deleteMany({});
    rmSync(dir, { recursive: true, force: true });
  });

  describe('validation', () => {
    const rejects = (value: unknown, message: string) => {
      expect(() => service.validate(value)).toThrow(BadRequestException);
      expect(() => service.validate(value)).toThrow(message);
    };

    it('accepts JPG and PNG up to exactly 5 MB', () => {
      expect(service.validate(file(JPEG_BYTES))).toBe('jpg');
      expect(service.validate(file(PNG_BYTES, 'image/png'))).toBe('png');
      expect(service.validate(file(jpegOfSize(MAX_IMAGE_BYTES)))).toBe('jpg');
    });

    it('rejects a missing or empty file', () => {
      rejects(undefined, UPLOAD_ERRORS.missing);
      rejects({ originalname: 'x.jpg' }, UPLOAD_ERRORS.missing);
      rejects(file(Buffer.alloc(0)), UPLOAD_ERRORS.empty);
    });

    it('rejects a file over 5 MB', () => {
      rejects(file(jpegOfSize(MAX_IMAGE_BYTES + 1)), UPLOAD_ERRORS.tooLarge);
    });

    it('checks the real content, not the name or mimetype the client sent', () => {
      // A GIF renamed to .jpg with a JPEG mimetype is still rejected.
      rejects(
        file(Buffer.from('GIF89a......'), 'image/jpeg', 'cat.jpg'),
        UPLOAD_ERRORS.wrongType,
      );
      // A real PNG sent as "text/plain" with a .txt name is accepted as PNG.
      expect(service.validate(file(PNG_BYTES, 'text/plain', 'notes.txt'))).toBe(
        'png',
      );
    });
  });

  describe('upload', () => {
    it('stores the file under a random name and returns its info', async () => {
      const stored = await service.upload(
        file(PNG_BYTES, 'image/png', '../../evil name.png'),
        post,
        'user-1',
      );

      expect(stored.fileName).toMatch(/^[0-9a-f-]{36}\.png$/);
      expect(stored.url).toBe(`/api/uploads/${stored.fileName}`);
      expect(stored.mimeType).toBe('image/png');
      expect(stored.size).toBe(PNG_BYTES.length);
      // The original file name is never used on disk.
      expect(filesOnDisk()).toEqual([stored.fileName]);
      expect(readFileSync(join(dir, stored.fileName))).toEqual(PNG_BYTES);

      const record = await model.findById(stored.id).lean();
      expect(record).toMatchObject({
        ownerType: 'post',
        ownerId: post.id,
        uploaderId: 'user-1',
        fileName: stored.fileName,
      });
    });

    it('stores nothing when the file is rejected', async () => {
      await expect(
        service.upload(file(Buffer.from('not an image')), post),
      ).rejects.toThrow(BadRequestException);
      expect(filesOnDisk()).toEqual([]);
      expect(await model.countDocuments()).toBe(0);
    });

    it('deletes the file again if saving the record fails', async () => {
      jest.spyOn(model, 'create').mockRejectedValueOnce(new Error('db down'));
      await expect(service.upload(file(JPEG_BYTES), post)).rejects.toThrow(
        'db down',
      );
      expect(filesOnDisk()).toEqual([]);
    });

    it('counts the images of an item', async () => {
      await service.upload(file(JPEG_BYTES), post);
      await service.upload(file(PNG_BYTES), post);
      await service.upload(file(JPEG_BYTES), { type: 'activity', id: 'a1' });
      expect(await service.countFor(post)).toBe(2);
    });
  });

  describe('delete', () => {
    it('removes the record and the file', async () => {
      const stored = await service.upload(file(JPEG_BYTES), post);
      await service.delete(stored.id);
      expect(await model.countDocuments()).toBe(0);
      expect(filesOnDisk()).toEqual([]);
    });

    it('deletes by URL, for stores that keep URLs (airline logo, hotel photos)', async () => {
      const stored = await service.upload(file(JPEG_BYTES), {
        type: 'airline',
        id: 'airline-1',
      });
      await service.deleteByUrl(stored.url);
      expect(await model.countDocuments()).toBe(0);
      expect(filesOnDisk()).toEqual([]);
    });

    it('ignores unknown ids and foreign URLs', async () => {
      const stored = await service.upload(file(JPEG_BYTES), post);
      await service.delete(new Types.ObjectId().toString());
      await service.delete('not-an-id');
      await service.deleteByUrl('https://example.com/logo.png');
      await service.deleteByUrl(`/elsewhere/${stored.fileName}`);
      expect(await model.countDocuments()).toBe(1);
      expect(filesOnDisk()).toEqual([stored.fileName]);
    });
  });

  describe('copy', () => {
    it('makes an independent copy for another item', async () => {
      const original = await service.upload(file(PNG_BYTES), {
        type: 'activity',
        id: 'a1',
      });
      const copy = await service.copy(original.id, {
        type: 'activity',
        id: 'a2',
      });

      expect(copy).not.toBeNull();
      expect(copy!.fileName).not.toBe(original.fileName);
      // Deleting the original leaves the copy intact.
      await service.delete(original.id);
      expect(filesOnDisk()).toEqual([copy!.fileName]);
      expect(readFileSync(join(dir, copy!.fileName))).toEqual(PNG_BYTES);
    });

    it('returns null when the original is gone', async () => {
      expect(
        await service.copy(new Types.ObjectId().toString(), post),
      ).toBeNull();
    });
  });

  describe('findFile', () => {
    it('finds stored files and refuses anything else', async () => {
      const stored = await service.upload(file(JPEG_BYTES), post);
      expect(await service.findFile(stored.fileName)).toEqual({
        path: join(dir, stored.fileName),
        mimeType: 'image/jpeg',
      });
      expect(await service.findFile('../.env')).toBeNull();
      expect(
        await service.findFile(
          `${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.jpg`,
        ),
      ).toBeNull();

      rmSync(join(dir, stored.fileName));
      expect(await service.findFile(stored.fileName)).toBeNull();
    });
  });
});
