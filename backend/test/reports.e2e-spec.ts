/**
 * Content reports & admin moderation e2e (GEN-09, GEN-10, GEN-07, GEN-01).
 * Runs against an in-memory MongoDB replica set (transactions need one).
 * It never touches Atlas: MONGODB_URI is overridden before the app boots and
 * the test asserts the connection is local.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';

import { AuditLogsService } from '../src/audit-logs/audit-logs.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

jest.setTimeout(180_000);

describe('Reports & moderation (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let admin: TestAgent;
  let alice: TestAgent; // author of all content
  let bob: TestAgent;
  let carol: TestAgent;

  let postId: string;
  let draftPostId: string;
  let commentId: string;
  let reviewId: string;
  let itineraryId: string;

  const ADMIN = { email: 'admin@e2e.test', password: 'AdminPass123' };
  const PASSWORD = 'TravelPass123';

  const login = async (email: string, password: string) => {
    const agent = request.agent(server);
    await agent.post('/api/auth/login').send({ email, password }).expect(201);
    return agent;
  };

  const register = async (name: string, email: string) => {
    await request(server)
      .post('/api/auth/register')
      .send({
        name,
        email,
        password: PASSWORD,
        termsAccepted: true,
        privacyPolicyAccepted: true,
      })
      .expect(201);
    const user = await connection.collection('users').findOne({ email });
    return user!._id;
  };

  const notificationTypes = async (agent: TestAgent) => {
    const list = await agent.get('/api/notifications').expect(200);
    return list.body.items.map((n: { type: string }) => n.type) as string[];
  };

  const report = (agent: TestAgent, targetType: string, targetId: string) =>
    agent
      .post('/api/reports')
      .send({ targetType, targetId, reason: 'spam' });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('e2e');
    process.env.JWT_ACCESS_SECRET = 'e2e-access-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-refresh-secret';

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
    // Make sure the partial unique index exists before the race checks.
    await connection.model('Report').syncIndexes();

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

    const aliceId = await register('Alice Author', 'alice@e2e.test');
    await register('Bob Reporter', 'bob@e2e.test');
    await register('Carol Reporter', 'carol@e2e.test');

    const posts = connection.collection('posts');
    postId = (
      await posts.insertOne({
        authorId: aliceId,
        title: 'Five days in Aswan',
        content: 'Visit our shop at example.test! '.repeat(20),
        status: 'published',
        isHidden: false,
      })
    ).insertedId.toString();
    draftPostId = (
      await posts.insertOne({
        authorId: aliceId,
        title: 'Draft',
        content: 'not yet',
        status: 'draft',
        isHidden: false,
      })
    ).insertedId.toString();
    commentId = (
      await connection.collection('comments').insertOne({
        postId: new Types.ObjectId(postId),
        authorId: aliceId,
        content: 'Buy followers here',
        isHidden: false,
      })
    ).insertedId.toString();
    await connection
      .collection('likes')
      .insertOne({ postId: new Types.ObjectId(postId), userId: aliceId });
    reviewId = (
      await connection.collection('reviews').insertOne({
        userId: aliceId,
        hotelId: new Types.ObjectId(),
        comment: 'Terrible, avoid',
        isHidden: false,
      })
    ).insertedId.toString();
    itineraryId = (
      await connection.collection('itineraries').insertOne({
        ownerId: aliceId,
        title: 'Luxor in a weekend',
        isPublic: true,
        isHidden: false,
      })
    ).insertedId.toString();

    admin = await login(ADMIN.email, ADMIN.password);
    alice = await login('alice@e2e.test', PASSWORD);
    bob = await login('bob@e2e.test', PASSWORD);
    carol = await login('carol@e2e.test', PASSWORD);
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  it('lets users report visible content once (GEN-09)', async () => {
    const created = await report(bob, 'post', postId).expect(201);
    expect(created.body).toMatchObject({
      targetType: 'post',
      targetId: postId,
      reason: 'spam',
      status: 'open',
    });

    await report(bob, 'post', postId).expect(409);
    await report(alice, 'post', postId).expect(403);
    await report(bob, 'post', draftPostId).expect(404);
    await report(bob, 'post', new Types.ObjectId().toString()).expect(404);
    await report(bob, 'post', 'not-an-id').expect(400);
    await report(bob, 'profile', postId).expect(400);
    await bob
      .post('/api/reports')
      .send({ targetType: 'post', targetId: postId, reason: 'other' })
      .expect(400);
    await request(server)
      .post('/api/reports')
      .send({ targetType: 'post', targetId: postId, reason: 'spam' })
      .expect(401);

    await report(carol, 'post', postId).expect(201);

    const mine = await bob.get('/api/reports/mine').expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0].snapshot).toEqual({
      title: 'Five days in Aswan',
      excerpt: expect.any(String),
    });
    expect(mine.body.items[0].snapshot.excerpt).toHaveLength(200);
    expect(JSON.stringify(mine.body)).not.toMatch(/resolvedBy|resolutionNote/);
  });

  it('lists open reports for admins with names and counts (GEN-10)', async () => {
    const list = await admin.get('/api/admin/reports').expect(200);
    expect(list.body.total).toBe(2);
    expect(list.body.items[0]).toMatchObject({
      targetType: 'post',
      status: 'open',
      reporter: { name: 'Carol Reporter', email: 'carol@e2e.test' },
      snapshot: { title: 'Five days in Aswan', authorName: 'Alice Author' },
      openReportsOnTarget: 2,
      resolvedBy: null,
    });
    await bob.get('/api/admin/reports').expect(403);
    await admin
      .get('/api/admin/reports')
      .query({ from: '2026-12-01', to: '2026-11-01' })
      .expect(400);
  });

  it('dismisses every open report on the content at once (D8, D18)', async () => {
    const list = await admin.get('/api/admin/reports').expect(200);
    const bobReport = list.body.items.find(
      (r: { reporter: { name: string } }) => r.reporter.name === 'Bob Reporter',
    );

    const dismissed = await admin
      .patch(`/api/admin/reports/${bobReport.id}`)
      .send({ action: 'dismiss', note: 'Travel tips, not spam' })
      .expect(200);
    expect(dismissed.body).toEqual({
      id: bobReport.id,
      status: 'dismissed',
      resolvedReports: 2,
    });

    const all = await admin
      .get('/api/admin/reports')
      .query({ status: 'all' })
      .expect(200);
    expect(all.body.items.map((r: { status: string }) => r.status)).toEqual([
      'dismissed',
      'dismissed',
    ]);
    await admin
      .patch(`/api/admin/reports/${bobReport.id}`)
      .send({ action: 'hide' })
      .expect(409);

    expect(await notificationTypes(bob)).toEqual(['REPORT_RESOLVED']);
    expect(await notificationTypes(carol)).toEqual(['REPORT_RESOLVED']);
    expect(await notificationTypes(alice)).toEqual([]);
    const note = (await bob.get('/api/notifications').expect(200)).body
      .items[0];
    expect(note.payload.outcome).toBe('no_violation');
    expect(JSON.stringify(note)).not.toMatch(/Carol|Admin/);
  });

  it('hides content through a report and keeps it hidden from reporters (GEN-10)', async () => {
    const again = await report(bob, 'post', postId).expect(201);

    const hidden = await admin
      .patch(`/api/admin/reports/${again.body.id}`)
      .send({ action: 'hide' })
      .expect(200);
    expect(hidden.body).toEqual({
      id: again.body.id,
      status: 'content_hidden',
      resolvedReports: 1,
    });

    const post = await connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(postId) });
    expect(post?.isHidden).toBe(true);
    expect(await notificationTypes(alice)).toEqual(['CONTENT_HIDDEN']);

    await report(bob, 'post', postId).expect(404);
    // Its comment is unreachable through the hidden post.
    await report(bob, 'comment', commentId).expect(404);

    await admin
      .patch(`/api/admin/content/post/${postId}/hide`)
      .expect(409);
  });

  it('unhides without reopening reports (D10)', async () => {
    const shown = await admin
      .patch(`/api/admin/content/post/${postId}/unhide`)
      .send({ note: 'Appeal accepted' })
      .expect(200);
    expect(shown.body).toEqual({
      targetType: 'post',
      targetId: postId,
      isHidden: false,
      resolvedReports: 0,
    });
    await admin.patch(`/api/admin/content/post/${postId}/unhide`).expect(409);

    const open = await admin.get('/api/admin/reports').expect(200);
    expect(open.body.total).toBe(0);
    expect(await notificationTypes(alice)).toEqual([
      'CONTENT_UNHIDDEN',
      'CONTENT_HIDDEN',
    ]);
  });

  it('deletes a comment and resolves its reports (GEN-10)', async () => {
    await report(bob, 'comment', commentId).expect(201);
    const deleted = await admin
      .delete(`/api/admin/content/comment/${commentId}`)
      .query({ note: 'Spam link' })
      .expect(200);
    expect(deleted.body).toEqual({
      targetType: 'comment',
      targetId: commentId,
      deleted: true,
      resolvedReports: 1,
    });

    expect(
      await connection
        .collection('comments')
        .countDocuments({ _id: new Types.ObjectId(commentId) }),
    ).toBe(0);
    const mine = await bob
      .get('/api/reports/mine')
      .query({ status: 'content_deleted' })
      .expect(200);
    expect(mine.body.items[0]).toMatchObject({
      targetType: 'comment',
      snapshot: { title: null, excerpt: 'Buy followers here' },
    });
    await admin.delete(`/api/admin/content/comment/${commentId}`).expect(404);
  });

  it('answers 501 for deleting reviews until their owner enables it (D16)', async () => {
    await admin.delete(`/api/admin/content/review/${reviewId}`).expect(501);
    await admin.delete(`/api/admin/content/ship/${reviewId}`).expect(400);
    await admin.delete('/api/admin/content/review/not-an-id').expect(400);
  });

  it('rolls everything back when the audit write fails (D12)', async () => {
    const created = await report(bob, 'review', reviewId).expect(201);
    const auditLogs = app.get(AuditLogsService, { strict: false });
    jest
      .spyOn(auditLogs, 'record')
      .mockRejectedValueOnce(new Error('simulated failure'));

    await admin
      .patch(`/api/admin/reports/${created.body.id}`)
      .send({ action: 'hide' })
      .expect(500);

    const review = await connection
      .collection('reviews')
      .findOne({ _id: new Types.ObjectId(reviewId) });
    expect(review?.isHidden).toBe(false);
    const stored = await connection
      .collection('reports')
      .findOne({ _id: new Types.ObjectId(created.body.id) });
    expect(stored?.status).toBe('open');
  });

  it('lets exactly one of two parallel resolutions win (D13)', async () => {
    const open = await admin
      .get('/api/admin/reports')
      .query({ targetType: 'review' })
      .expect(200);
    const id = open.body.items[0].id;

    const results = await Promise.all([
      admin.patch(`/api/admin/reports/${id}`).send({ action: 'dismiss' }),
      admin.patch(`/api/admin/reports/${id}`).send({ action: 'hide' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('records every moderation action in the audit log (GEN-07)', async () => {
    const logs = await admin.get('/api/admin/audit-logs').expect(200);
    const actions = logs.body.items.map((l: { action: string }) => l.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'REPORT_DISMISSED',
        'CONTENT_HIDDEN',
        'CONTENT_UNHIDDEN',
        'CONTENT_DELETED',
      ]),
    );
    const deleted = logs.body.items.find(
      (l: { action: string }) => l.action === 'CONTENT_DELETED',
    );
    expect(deleted).toMatchObject({
      targetType: 'comment',
      targetId: commentId,
      details: {
        reportIds: [expect.any(String)],
        snapshot: { excerpt: 'Buy followers here' },
        note: 'Spam link',
      },
    });
  });

  it('keeps itineraries reportable while public', async () => {
    await report(carol, 'itinerary', itineraryId).expect(201);
    await connection
      .collection('itineraries')
      .updateOne(
        { _id: new Types.ObjectId(itineraryId) },
        { $set: { isPublic: false } },
      );
    await report(bob, 'itinerary', itineraryId).expect(404);
  });
});
