/**
 * Blog e2e (BLG-01 – BLG-12, GEN-10). Runs against an in-memory MongoDB
 * replica set (transactions need one). It never touches Atlas: MONGODB_URI
 * is overridden before the app boots and the test asserts the connection is
 * local.
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

import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

jest.setTimeout(180_000);

describe('Blog (e2e)', () => {
  let replSet: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let admin: TestAgent;
  let alice: TestAgent; // author
  let bob: TestAgent;
  let carol: TestAgent;
  let dave: TestAgent;
  let erin: TestAgent;
  let aliceId: Types.ObjectId;
  let bobId: Types.ObjectId;

  let postId: string;
  let otherPostId: string;
  let commentId: string;

  const ADMIN = { email: 'admin@blog.test', password: 'AdminPass123' };
  const PASSWORD = 'TravelPass123';

  const login = async (email: string, password = PASSWORD) => {
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

  const guest = () => request(server);

  const storedPost = () =>
    connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(postId) });

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.MONGODB_URI = replSet.getUri('blog-e2e');
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
    await Promise.all(
      Object.values(connection.models).map((m) => m.syncIndexes()),
    );

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

    aliceId = await register('Alice Author', 'alice@blog.test');
    bobId = await register('Bob Reader', 'bob@blog.test');
    await register('Carol Reader', 'carol@blog.test');
    await register('Dave Reader', 'dave@blog.test');
    await register('Erin Reader', 'erin@blog.test');

    admin = await login(ADMIN.email, ADMIN.password);
    alice = await login('alice@blog.test');
    bob = await login('bob@blog.test');
    carol = await login('carol@blog.test');
    dave = await login('dave@blog.test');
    erin = await login('erin@blog.test');
  });

  afterAll(async () => {
    await app?.close();
    await replSet?.stop();
  });

  describe('posts (BLG-01 – BLG-04)', () => {
    it('creates a draft that only its author can see', async () => {
      const created = await alice
        .post('/api/posts')
        .send({
          title: '  Five days in Aswan  ',
          content: 'We took the night train from Cairo.',
          tags: ['Egypt ', 'egypt', 'Nile-Cruise'],
        })
        .expect(201);
      postId = created.body.id;
      expect(created.body).toMatchObject({
        title: 'Five days in Aswan',
        tags: ['egypt', 'nile-cruise'],
        status: 'draft',
        isHidden: false,
        isOwner: true,
        publishedAt: null,
        author: { id: aliceId.toString(), name: 'Alice Author' },
      });

      await guest().get(`/api/posts/${postId}`).expect(404);
      await bob.get(`/api/posts/${postId}`).expect(404);
      await admin.get(`/api/posts/${postId}`).expect(404);
      await alice.get(`/api/posts/${postId}`).expect(200);
      await bob.patch(`/api/posts/${postId}`).send({ title: 'Nope' }).expect(404);
    });

    it('rejects invalid posts and unauthenticated writes', async () => {
      await alice.post('/api/posts').send({ title: 'ab', content: 'x' }).expect(400);
      await alice
        .post('/api/posts')
        .send({ title: 'Valid', content: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] })
        .expect(400);
      await alice
        .post('/api/posts')
        .send({ title: 'Valid', content: 'x', tags: ['new york'] })
        .expect(400);
      await guest().post('/api/posts').send({ title: 'Valid', content: 'x' }).expect(401);
      await admin.post('/api/posts').send({ title: 'Valid', content: 'x' }).expect(403);
      await guest().get('/api/posts/not-an-id').expect(400);
    });

    it('publishes once and keeps the first publishedAt (D3)', async () => {
      const published = await alice
        .patch(`/api/posts/${postId}`)
        .send({ status: 'published' })
        .expect(200);
      const firstPublishedAt = published.body.publishedAt;
      expect(firstPublishedAt).toEqual(expect.any(String));

      const read = await guest().get(`/api/posts/${postId}`).expect(200);
      expect(read.body).toMatchObject({ title: 'Five days in Aswan', isOwner: false });
      expect(read.body.status).toBeUndefined();

      await alice.patch(`/api/posts/${postId}`).send({ status: 'draft' }).expect(200);
      await guest().get(`/api/posts/${postId}`).expect(404);
      const again = await alice
        .patch(`/api/posts/${postId}`)
        .send({ status: 'published' })
        .expect(200);
      expect(again.body.publishedAt).toBe(firstPublishedAt);

      await bob.patch(`/api/posts/${postId}`).send({ title: 'Mine' }).expect(403);
      await bob.delete(`/api/posts/${postId}`).expect(403);
    });

    it('lists my posts with drafts first by update time (BLG-03)', async () => {
      const draft = await alice
        .post('/api/posts')
        .send({ title: 'Unfinished Luxor notes', content: 'TBD' })
        .expect(201);
      const mine = await alice.get('/api/posts/mine').expect(200);
      expect(mine.body.items.map((p: { id: string }) => p.id)).toEqual([
        draft.body.id,
        postId,
      ]);
      expect(mine.body.items[0]).toMatchObject({ status: 'draft', isHidden: false });

      const drafts = await alice.get('/api/posts/mine?status=draft').expect(200);
      expect(drafts.body.total).toBe(1);
      await guest().get('/api/posts/mine').expect(401);
      await alice.delete(`/api/posts/${draft.body.id}`).expect(200);
    });
  });

  describe('search and tags (BLG-08, BLG-09)', () => {
    it('finds posts by keyword in title, tag and author name', async () => {
      const other = await bob
        .post('/api/posts')
        .send({
          title: 'A weekend in Dubai',
          content: 'Desert safari.',
          tags: ['uae'],
          status: 'published',
        })
        .expect(201);
      otherPostId = other.body.id;

      const all = await guest().get('/api/posts').expect(200);
      // Same score (0): newest first.
      expect(all.body.items.map((p: { id: string }) => p.id)).toEqual([
        otherPostId,
        postId,
      ]);

      const ids = async (q: string) =>
        (await guest().get('/api/posts').query({ q }).expect(200)).body.items.map(
          (p: { id: string }) => p.id,
        );
      expect(await ids('aswan')).toEqual([postId]);
      expect(await ids('NILE')).toEqual([postId]);
      expect(await ids('bob reader')).toEqual([otherPostId]);
      // Content is not searched (BLG-09: title, tags, author name).
      expect(await ids('night train')).toEqual([]);
      // Regex characters match literally.
      expect(await ids('.*')).toEqual([]);

      const byAuthor = await guest()
        .get('/api/posts')
        .query({ authorId: aliceId.toString() })
        .expect(200);
      expect(byAuthor.body.total).toBe(1);
    });

    it('lists posts by tag', async () => {
      const tagged = await guest().get('/api/tags/EGYPT/posts').expect(200);
      expect(tagged.body).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
      expect(tagged.body.items[0]).toMatchObject({
        id: postId,
        tags: ['egypt', 'nile-cruise'],
        coverImage: null,
        likeCount: 0,
        commentCount: 0,
      });
      const query = await guest().get('/api/posts?tag=egypt').expect(200);
      expect(query.body.items).toEqual(tagged.body.items);
      await guest().get('/api/tags/new%20york/posts').expect(400);
      await guest().get('/api/posts?page=0').expect(400);
    });

    it('treats an invalid session cookie as a guest', async () => {
      await guest()
        .get(`/api/posts/${postId}`)
        .set('Cookie', 'access_token=garbage')
        .expect(200);
    });
  });

  describe('comments and likes (BLG-05 – BLG-07)', () => {
    const likeCount = async () => (await storedPost())?.likeCount;

    it('lets users comment on a published post and counts it', async () => {
      const created = await bob
        .post(`/api/posts/${postId}/comments`)
        .send({ content: '  The felucca at sunset!  ' })
        .expect(201);
      commentId = created.body.id;
      expect(created.body).toMatchObject({
        content: 'The felucca at sunset!',
        author: { id: bobId.toString(), name: 'Bob Reader' },
        editedAt: null,
        isOwner: true,
        isHidden: false,
      });
      expect((await storedPost())?.commentCount).toBe(1);

      await bob
        .post(`/api/posts/${postId}/comments`)
        .send({ content: 'a'.repeat(501) })
        .expect(400);
      await bob.post(`/api/posts/${postId}/comments`).send({ content: '   ' }).expect(400);
      await guest().post(`/api/posts/${postId}/comments`).send({ content: 'hi' }).expect(401);

      const list = await guest().get(`/api/posts/${postId}/comments`).expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].isHidden).toBeUndefined();
    });

    it('lets only the comment author edit or delete it (BLG-07)', async () => {
      const edited = await bob
        .patch(`/api/comments/${commentId}`)
        .send({ content: 'The felucca at sunset was magic!' })
        .expect(200);
      expect(edited.body.editedAt).toEqual(expect.any(String));

      await alice.patch(`/api/comments/${commentId}`).send({ content: 'no' }).expect(403);
      await alice.delete(`/api/comments/${commentId}`).expect(403);
      await admin.delete(`/api/comments/${commentId}`).expect(403);

      const extra = await carol
        .post(`/api/posts/${postId}/comments`)
        .send({ content: 'Going next month' })
        .expect(201);
      expect((await storedPost())?.commentCount).toBe(2);
      await carol.delete(`/api/comments/${extra.body.id}`).expect(200);
      expect((await storedPost())?.commentCount).toBe(1);
      await carol.delete(`/api/comments/${extra.body.id}`).expect(404);
    });

    it('keeps one like per user however often they like (D13)', async () => {
      const first = await bob.post(`/api/posts/${postId}/like`).expect(200);
      expect(first.body).toEqual({ liked: true, likeCount: 1 });
      const again = await bob.post(`/api/posts/${postId}/like`).expect(200);
      expect(again.body).toEqual({ liked: true, likeCount: 1 });

      const detail = await bob.get(`/api/posts/${postId}`).expect(200);
      expect(detail.body).toMatchObject({ likedByMe: true, likeCount: 1 });
      const guestView = await guest().get(`/api/posts/${postId}`).expect(200);
      expect(guestView.body.likedByMe).toBe(false);

      await bob.delete(`/api/posts/${postId}/like`).expect(200, { liked: false, likeCount: 0 });
      await bob.delete(`/api/posts/${postId}/like`).expect(200, { liked: false, likeCount: 0 });
      await guest().post(`/api/posts/${postId}/like`).expect(401);
      await admin.post(`/api/posts/${postId}/like`).expect(403);
    });

    it('counts 20 parallel likes from one user once', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => bob.post(`/api/posts/${postId}/like`)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(20).fill(200));
      expect(results.every((r) => r.body.liked === true)).toBe(true);
      expect(
        await connection
          .collection('likes')
          .countDocuments({ postId: new Types.ObjectId(postId), userId: bobId }),
      ).toBe(1);
      expect(await likeCount()).toBe(1);
    });

    it('counts parallel likes from 5 users exactly', async () => {
      await bob.delete(`/api/posts/${postId}/like`).expect(200);
      const results = await Promise.all(
        [alice, bob, carol, dave, erin].map((u) =>
          u.post(`/api/posts/${postId}/like`),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
      expect(await likeCount()).toBe(5);
      expect(
        await connection
          .collection('likes')
          .countDocuments({ postId: new Types.ObjectId(postId) }),
      ).toBe(5);
    });

    it('ranks the liked post first in search (D8)', async () => {
      const all = await guest().get('/api/posts').expect(200);
      expect(all.body.items.map((p: { id: string }) => p.id)).toEqual([
        postId,
        otherPostId,
      ]);
      expect(all.body.items[0]).toMatchObject({ likeCount: 5, commentCount: 1 });
    });

    it('refuses comments and likes on drafts', async () => {
      await carol.get(`/api/posts/${otherPostId}`).expect(200);
      await bob.patch(`/api/posts/${otherPostId}`).send({ status: 'draft' }).expect(200);
      await carol.post(`/api/posts/${otherPostId}/like`).expect(404);
      await carol
        .post(`/api/posts/${otherPostId}/comments`)
        .send({ content: 'hi' })
        .expect(404);
      await bob.post(`/api/posts/${otherPostId}/like`).expect(404);
      await guest().get(`/api/posts/${otherPostId}/comments`).expect(404);
      await bob.patch(`/api/posts/${otherPostId}`).send({ status: 'published' }).expect(200);
    });
  });

  describe('moderation, images and author pages (GEN-10, BLG-10, BLG-12)', () => {
    const commentsFor = async (agent: TestAgent | ReturnType<typeof guest>) =>
      (await agent.get(`/api/posts/${postId}/comments`).expect(200)).body;
    const reportStatus = async (id: string) =>
      (
        await connection
          .collection('reports')
          .findOne({ _id: new Types.ObjectId(id) })
      )?.status;

    it('hides a comment via GEN-10 and keeps commentCount in step', async () => {
      const reported = await carol
        .post('/api/reports')
        .send({ targetType: 'comment', targetId: commentId, reason: 'spam' })
        .expect(201);
      await admin
        .patch(`/api/admin/reports/${reported.body.id}`)
        .send({ action: 'hide' })
        .expect(200);
      expect((await storedPost())?.commentCount).toBe(0);

      const own = await commentsFor(bob);
      expect(own.total).toBe(1);
      expect(own.items[0]).toMatchObject({
        id: commentId,
        isHidden: true,
        isOwner: true,
      });
      expect((await commentsFor(carol)).total).toBe(0);
      expect((await commentsFor(guest())).total).toBe(0);
      expect((await commentsFor(admin)).items[0].isHidden).toBe(true);

      // Its author can still edit it while hidden (D11); others now get 404.
      await bob
        .patch(`/api/comments/${commentId}`)
        .send({ content: 'Edited while hidden' })
        .expect(200);
      await carol
        .patch(`/api/comments/${commentId}`)
        .send({ content: 'no' })
        .expect(404);

      await admin
        .patch(`/api/admin/content/comment/${commentId}/unhide`)
        .expect(200);
      expect((await storedPost())?.commentCount).toBe(1);
      expect((await commentsFor(carol)).total).toBe(1);
    });

    it('hides a post from everyone but its author and admins', async () => {
      await admin.patch(`/api/admin/content/post/${postId}/hide`).expect(200);
      await guest().get(`/api/posts/${postId}`).expect(404);
      await bob.get(`/api/posts/${postId}`).expect(404);
      await guest().get(`/api/posts/${postId}/comments`).expect(404);
      const own = await alice.get(`/api/posts/${postId}`).expect(200);
      expect(own.body.isHidden).toBe(true);
      await admin.get(`/api/posts/${postId}`).expect(200);
      const search = await guest().get('/api/posts').expect(200);
      expect(search.body.items.map((p: { id: string }) => p.id)).toEqual([
        otherPostId,
      ]);
      await bob
        .patch(`/api/posts/${postId}`)
        .send({ title: 'Not mine' })
        .expect(404);
      await bob.post(`/api/posts/${postId}/like`).expect(404);
      await admin.patch(`/api/admin/content/post/${postId}/unhide`).expect(200);
    });

    it('answers 501 for images until the upload module is bound (D15)', async () => {
      await alice
        .post(`/api/posts/${postId}/images`)
        .attach('file', Buffer.from([0xff, 0xd8, 0xff]), 'nile.jpg')
        .expect(501);
      await alice.delete(`/api/posts/${postId}/images/abc`).expect(501);
      await guest().post(`/api/posts/${postId}/images`).expect(401);
    });

    it('shows an author page with published posts and public itineraries (BLG-12)', async () => {
      const base = Date.UTC(2026, 9, 1);
      const day = 86_400_000;
      await connection.collection('itineraries').insertMany([
        ...Array.from({ length: 11 }, (_, i) => ({
          ownerId: aliceId,
          title: `Public trip ${i}`,
          countries: ['EG'],
          isPublic: true,
          isHidden: false,
          createdAt: new Date(base + i * day),
        })),
        {
          ownerId: aliceId,
          title: 'Private trip',
          isPublic: false,
          createdAt: new Date(base + 99 * day),
        },
        {
          ownerId: aliceId,
          title: 'Hidden trip',
          isPublic: true,
          isHidden: true,
          createdAt: new Date(base + 98 * day),
        },
        {
          ownerId: bobId,
          title: 'Bob trip',
          isPublic: true,
          createdAt: new Date(base),
        },
      ]);

      const page = await guest().get(`/api/authors/${aliceId}`).expect(200);
      expect(page.body).toMatchObject({
        id: aliceId.toString(),
        name: 'Alice Author',
        joinedAt: expect.any(String),
        publishedPostCount: 1,
        posts: {
          total: 1,
          items: [{ id: postId, likeCount: 5, commentCount: 1 }],
        },
      });
      const titles: string[] = page.body.publicItineraries.map(
        (i: { title: string }) => i.title,
      );
      expect(titles).toHaveLength(10);
      expect(titles[0]).toBe('Public trip 10');
      for (const excluded of ['Private trip', 'Hidden trip', 'Bob trip']) {
        expect(titles).not.toContain(excluded);
      }

      // Drafts are not on the author page.
      const draft = await alice
        .post('/api/posts')
        .send({ title: 'Secret draft', content: 'x' })
        .expect(201);
      const again = await guest().get(`/api/authors/${aliceId}`).expect(200);
      expect(again.body.publishedPostCount).toBe(1);
      await alice.delete(`/api/posts/${draft.body.id}`).expect(200);

      const adminUser = await connection
        .collection('users')
        .findOne({ email: ADMIN.email });
      await guest().get(`/api/authors/${adminUser!._id}`).expect(404);
      await guest().get(`/api/authors/${new Types.ObjectId()}`).expect(404);
      await guest().get('/api/authors/not-an-id').expect(400);
    });

    it('deletes a post with its comments, likes and open reports (D6)', async () => {
      const postReport = await carol
        .post('/api/reports')
        .send({ targetType: 'post', targetId: postId, reason: 'spam' })
        .expect(201);
      const commentReport = await dave
        .post('/api/reports')
        .send({ targetType: 'comment', targetId: commentId, reason: 'spam' })
        .expect(201);

      await alice
        .delete(`/api/posts/${postId}`)
        .expect(200)
        .expect({ id: postId, deleted: true });

      const _id = new Types.ObjectId(postId);
      expect(await storedPost()).toBeNull();
      expect(
        await connection.collection('comments').countDocuments({ postId: _id }),
      ).toBe(0);
      expect(
        await connection.collection('likes').countDocuments({ postId: _id }),
      ).toBe(0);
      for (const id of [postReport.body.id, commentReport.body.id]) {
        const report = await connection
          .collection('reports')
          .findOne({ _id: new Types.ObjectId(id) });
        expect(report).toMatchObject({
          status: 'content_deleted',
          resolvedBy: null,
          resolutionNote: 'Deleted by author',
        });
      }
      await alice.delete(`/api/posts/${postId}`).expect(404);
      await bob
        .patch(`/api/comments/${commentId}`)
        .send({ content: 'gone?' })
        .expect(404);
      const authorPage = await guest().get(`/api/authors/${aliceId}`).expect(200);
      expect(authorPage.body.publishedPostCount).toBe(0);
    });

    it('hides posts and author pages of deactivated authors (D4, D16)', async () => {
      const users = connection.collection('users');
      await users.updateOne(
        { email: 'bob@blog.test' },
        { $set: { status: 'deactivated' } },
      );
      await guest().get(`/api/posts/${otherPostId}`).expect(404);
      await admin.get(`/api/posts/${otherPostId}`).expect(200);
      expect((await guest().get('/api/posts').expect(200)).body.total).toBe(0);
      await guest().get(`/api/authors/${bobId}`).expect(404);

      await users.updateOne(
        { email: 'bob@blog.test' },
        { $set: { status: 'suspended' } },
      );
      // Suspended authors stay visible (ACC-16).
      await guest().get(`/api/posts/${otherPostId}`).expect(200);
      await guest().get(`/api/authors/${bobId}`).expect(200);
      await users.updateOne(
        { email: 'bob@blog.test' },
        { $set: { status: 'active' } },
      );
    });

    it('shows "Deleted user" for comments of deactivated accounts (D12)', async () => {
      const users = connection.collection('users');
      const c = await dave
        .post(`/api/posts/${otherPostId}/comments`)
        .send({ content: 'Nice' })
        .expect(201);
      await users.updateOne(
        { email: 'dave@blog.test' },
        { $set: { status: 'deactivated' } },
      );
      const list = await guest()
        .get(`/api/posts/${otherPostId}/comments`)
        .expect(200);
      expect(list.body.items[0]).toMatchObject({
        id: c.body.id,
        author: { id: null, name: 'Deleted user' },
      });
      await users.updateOne(
        { email: 'dave@blog.test' },
        { $set: { status: 'active' } },
      );
    });

    it('lets an admin delete a post with the same cascade (GEN-10)', async () => {
      const c = await carol
        .post(`/api/posts/${otherPostId}/comments`)
        .send({ content: 'Buy followers here' })
        .expect(201);
      await erin.post(`/api/posts/${otherPostId}/like`).expect(200);
      const commentReport = await erin
        .post('/api/reports')
        .send({ targetType: 'comment', targetId: c.body.id, reason: 'spam' })
        .expect(201);
      const postReport = await erin
        .post('/api/reports')
        .send({ targetType: 'post', targetId: otherPostId, reason: 'spam' })
        .expect(201);

      const deleted = await admin
        .delete(`/api/admin/content/post/${otherPostId}`)
        .expect(200);
      expect(deleted.body).toMatchObject({ deleted: true, resolvedReports: 1 });

      const _id = new Types.ObjectId(otherPostId);
      expect(await connection.collection('posts').countDocuments({ _id })).toBe(
        0,
      );
      expect(
        await connection.collection('comments').countDocuments({ postId: _id }),
      ).toBe(0);
      expect(
        await connection.collection('likes').countDocuments({ postId: _id }),
      ).toBe(0);
      expect(await reportStatus(postReport.body.id)).toBe('content_deleted');
      const closed = await connection
        .collection('reports')
        .findOne({ _id: new Types.ObjectId(commentReport.body.id) });
      expect(closed).toMatchObject({
        status: 'content_deleted',
        resolutionNote: 'Post deleted by an administrator',
      });
    });
  });
});
