/**
 * Admin & moderator e2e (ACC-13, ACC-15, ACC-16, ACC-17, ACC-07a, GEN-07, GEN-01).
 * Runs against an in-memory MongoDB replica set (transactions need one).
 * It never touches Atlas: MONGODB_URI is overridden before the app boots and
 * the test asserts the connection is local.
 */
import {
  Controller,
  Get,
  INestApplication,
  Module,
  Param,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import { ProviderOwnership } from '../src/auth/decorators/provider-ownership.decorator';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { ProviderOwnershipGuard } from '../src/auth/guards/provider-ownership.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { ModeratorAssignmentsModule } from '../src/moderator-assignments/moderator-assignments.module';
import { ModeratorAssignmentsService } from '../src/moderator-assignments/moderator-assignments.service';
import { UsersModule } from '../src/users/users.module';

jest.setTimeout(180_000);

/** Stand-in for a teammate's airline-management route. */
@Controller('test-airlines')
@UseGuards(AuthGuard, ProviderOwnershipGuard)
class TestAirlineController {
  @Get(':id')
  @ProviderOwnership('airline')
  get(@Param('id') id: string) {
    return { id, managed: true };
  }
}

@Module({
  imports: [UsersModule, JwtModule.register({}), ModeratorAssignmentsModule],
  controllers: [TestAirlineController],
})
class TestProviderModule {}

describe('Admin & moderator (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let admin: TestAgent;
  let airlineId: string;
  const otherAirlineId = new Types.ObjectId().toString();

  const ADMIN = { email: 'admin@e2e.test', password: 'AdminPass123' };
  const MODERATOR = {
    name: 'Mona Moderator',
    email: 'mona@e2e.test',
    temporaryPassword: 'temp',
  };

  const login = async (email: string, password: string) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(201);
    return agent;
  };

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('e2e');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, TestProviderModule],
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

    const now = new Date();
    await connection.collection('users').insertOne({
      name: 'E2E Admin',
      email: ADMIN.email,
      passwordHash: await bcrypt.hash(ADMIN.password, 4),
      role: 'admin',
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
    const airline = await connection
      .collection('airlines')
      .insertOne({ name: 'E2E Air', isActive: true });
    airlineId = airline.insertedId.toString();

    admin = await login(ADMIN.email, ADMIN.password);
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  it('runs the full moderator lifecycle (ACC-13, ACC-15, GEN-01)', async () => {
    const created = await admin
      .post('/api/admin/moderators')
      .send({ ...MODERATOR, providerType: 'airline', providerId: airlineId })
      .expect(201);
    expect(created.body).toMatchObject({
      email: MODERATOR.email,
      role: 'moderator',
      status: 'active',
      mustChangePassword: true,
      assignment: { providerType: 'airline', providerId: airlineId },
    });
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');

    // Temporary password: login works, but nothing else until it is changed.
    let moderator = await login(MODERATOR.email, MODERATOR.temporaryPassword);
    await moderator.get(`/api/test-airlines/${airlineId}`).expect(401);
    await moderator
      .patch('/api/auth/change-password')
      .send({
        currentPassword: MODERATOR.temporaryPassword,
        newPassword: 'NewModPass123',
      })
      .expect(200);
    moderator = await login(MODERATOR.email, 'NewModPass123');

    await moderator.get(`/api/test-airlines/${airlineId}`).expect(200);
    await moderator.get(`/api/test-airlines/${otherAirlineId}`).expect(403);
    await moderator.get('/api/admin/accounts').expect(403);
    const assignment = await moderator
      .get('/api/moderator/assignment')
      .expect(200);
    expect(assignment.body).toEqual({
      providerType: 'airline',
      providerId: airlineId,
      providerName: 'E2E Air',
      isActive: true,
    });

    const deactivated = await admin
      .patch(`/api/admin/providers/airline/${airlineId}/deactivate`)
      .expect(200);
    expect(deactivated.body).toEqual({
      providerType: 'airline',
      providerId: airlineId,
      isActive: false,
      notifiedUsers: 1,
    });
    await moderator.get(`/api/test-airlines/${airlineId}`).expect(403);
    await admin
      .patch(`/api/admin/providers/airline/${airlineId}/deactivate`)
      .expect(409);

    await admin
      .patch(`/api/admin/providers/airline/${airlineId}/reactivate`)
      .expect(200);
    await moderator.get(`/api/test-airlines/${airlineId}`).expect(200);

    const unread = await moderator
      .get('/api/notifications/unread-count')
      .expect(200);
    expect(unread.body).toEqual({ count: 2 });
    const list = await moderator.get('/api/notifications').expect(200);
    expect(list.body.items.map((n: { type: string }) => n.type)).toEqual([
      'PROVIDER_REACTIVATED',
      'PROVIDER_DEACTIVATED',
    ]);
    await moderator
      .patch(`/api/notifications/${list.body.items[0].id}/read`)
      .expect(200);
    // Another account cannot read it, and the id's existence is not revealed.
    await admin
      .patch(`/api/notifications/${list.body.items[1].id}/read`)
      .expect(404);
    const readAll = await moderator
      .patch('/api/notifications/read-all')
      .expect(200);
    expect(readAll.body).toEqual({ updated: 1 });
  });

  it('rejects bad input before touching the database', async () => {
    await admin.patch('/api/admin/providers/ship/abc/deactivate').expect(400);
    await admin
      .patch(`/api/admin/providers/airline/not-an-id/deactivate`)
      .expect(400);
    await admin
      .patch(`/api/admin/providers/hotel/${otherAirlineId}/deactivate`)
      .expect(404);
    await admin
      .post('/api/admin/moderators')
      .send({
        ...MODERATOR,
        email: 'x@e2e.test',
        providerType: 'airline',
        providerId: otherAirlineId,
      })
      .expect(404);
    await admin
      .post('/api/admin/moderators')
      .send({ ...MODERATOR, providerType: 'airline', providerId: airlineId })
      .expect(409);
  });

  it('rolls back the user when the assignment insert fails', async () => {
    const assignments = app.get(ModeratorAssignmentsService, {
      strict: false,
    });
    jest
      .spyOn(assignments, 'create')
      .mockRejectedValueOnce(new Error('simulated failure'));

    await admin
      .post('/api/admin/moderators')
      .send({
        ...MODERATOR,
        email: 'orphan@e2e.test',
        providerType: 'airline',
        providerId: airlineId,
      })
      .expect(500);
    expect(
      await connection
        .collection('users')
        .countDocuments({ email: 'orphan@e2e.test' }),
    ).toBe(0);
  });

  it('lets exactly one of two parallel suspends win (ACC-16)', async () => {
    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'Tara Traveller',
        email: 'tara@e2e.test',
        password: 'TravelPass123',
        termsAccepted: true,
        privacyPolicyAccepted: true,
      })
      .expect(201);
    const user = await connection
      .collection('users')
      .findOne({ email: 'tara@e2e.test' });
    expect(user).not.toBeNull();
    const id = user!._id.toString();

    const traveller = await login('tara@e2e.test', 'TravelPass123');

    const results = await Promise.all([
      admin.patch(`/api/admin/accounts/${id}/suspend`).send({ reason: 'A' }),
      admin.patch(`/api/admin/accounts/${id}/suspend`).send({ reason: 'B' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    // The suspended session ends immediately.
    await traveller.get('/api/notifications').expect(401);

    const accounts = await admin
      .get('/api/admin/accounts')
      .query({ search: 'TARA@e2e', status: 'suspended' })
      .expect(200);
    expect(accounts.body.total).toBe(1);
    expect(JSON.stringify(accounts.body)).not.toMatch(
      /passwordHash|refreshTokenHash/,
    );

    await admin
      .post(`/api/admin/users/${id}/reset-password`)
      .send({ temporaryPassword: 't' })
      .expect(200);
    await admin.patch(`/api/admin/accounts/${id}/reactivate`).expect(200);
    await admin.patch(`/api/admin/accounts/${id}/reactivate`).expect(409);
  });

  it('protects admin accounts from suspension and reset (D13)', async () => {
    const me = await admin.get('/api/auth/me').expect(200);
    const adminId: string = me.body.id;
    await admin.patch(`/api/admin/accounts/${adminId}/suspend`).expect(403);
    await admin
      .post(`/api/admin/users/${adminId}/reset-password`)
      .send({ temporaryPassword: 'x' })
      .expect(403);
  });

  it('lists flight and hotel bookings together, read-only (ACC-17)', async () => {
    const tara = await connection
      .collection('users')
      .findOne({ email: 'tara@e2e.test' });
    await connection.collection('flightbookings').insertOne({
      userId: tara!._id,
      airlineId: new Types.ObjectId(airlineId),
      status: 'Confirmed',
      bookingReference: 'FL-1',
      totalPrice: 300,
      currency: 'EGP',
      departureAt: new Date('2027-01-01'),
      createdAt: new Date('2026-11-01'),
    });
    await connection.collection('hotelbookings').insertOne({
      userId: tara!._id,
      hotelId: new Types.ObjectId(),
      status: 'Cancelled',
      bookingReference: 'HT-1',
      totalPrice: 120,
      currency: 'EUR',
      checkInDate: new Date('2027-02-01'),
      createdAt: new Date('2026-11-03'),
    });

    const all = await admin.get('/api/admin/bookings').expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((b: { type: string }) => b.type)).toEqual([
      'hotel',
      'flight',
    ]);
    expect(all.body.items[1]).toMatchObject({
      bookingReference: 'FL-1',
      userName: 'Tara Traveller',
      userEmail: 'tara@e2e.test',
      providerId: airlineId,
    });

    const flights = await admin
      .get('/api/admin/bookings')
      .query({ type: 'flight', status: 'Confirmed' })
      .expect(200);
    expect(flights.body.total).toBe(1);
    await admin
      .get('/api/admin/bookings')
      .query({ from: '2026-12-01', to: '2026-11-01' })
      .expect(400);
  });

  it('keeps an audit trail without secrets (GEN-07)', async () => {
    const logs = await admin.get('/api/admin/audit-logs').expect(200);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'MODERATOR_CREATED',
        'PROVIDER_DEACTIVATED',
        'PROVIDER_REACTIVATED',
        'ACCOUNT_SUSPENDED',
        'PASSWORD_RESET_BY_ADMIN',
      ]),
    );
    expect(logs.body.items[0].actorName).toBe('E2E Admin');
    expect(JSON.stringify(logs.body)).not.toMatch(/password"|temp"|\$2[aby]\$/);

    const suspended = await admin
      .get('/api/admin/audit-logs')
      .query({ action: 'ACCOUNT_SUSPENDED' })
      .expect(200);
    expect(suspended.body.total).toBe(1);
  });

  it('keeps admin routes away from non-admins', async () => {
    const traveller = await login('tara@e2e.test', 't');
    // Still on a temporary password after the reset: 401 everywhere else.
    await traveller.get('/api/admin/accounts').expect(401);
    await request(server).get('/api/admin/accounts').expect(401);
  });
});
