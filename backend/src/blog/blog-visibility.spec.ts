import { Types } from 'mongoose';

import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import {
  canViewComment,
  canViewPost,
  isPubliclyVisible,
  type Viewer,
} from './blog-visibility';

describe('Blog visibility (D4, D12)', () => {
  const authorId = new Types.ObjectId();
  const author: Viewer = { sub: authorId.toString(), role: UserRole.USER };
  const admin: Viewer = {
    sub: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
  };
  const other: Viewer = {
    sub: new Types.ObjectId().toString(),
    role: UserRole.USER,
  };
  const guest: Viewer = undefined;
  const active = { status: AccountStatus.ACTIVE };

  const post = (extra: { status?: string; isHidden?: boolean } = {}) => ({
    authorId,
    status: 'published',
    isHidden: false,
    ...extra,
  });

  const cases: Array<
    [string, ReturnType<typeof post>, { status?: string } | null, Record<string, boolean>]
  > = [
    ['published', post(), active, { author: true, admin: true, other: true, guest: true }],
    ['draft', post({ status: 'draft' }), active, { author: true, admin: false, other: false, guest: false }],
    ['hidden', post({ isHidden: true }), active, { author: true, admin: true, other: false, guest: false }],
    [
      'author deactivated',
      post(),
      { status: AccountStatus.DEACTIVATED },
      { author: false, admin: true, other: false, guest: false },
    ],
    ['author missing', post(), null, { author: false, admin: true, other: false, guest: false }],
    [
      'author suspended (ACC-16)',
      post(),
      { status: AccountStatus.SUSPENDED },
      { author: true, admin: true, other: true, guest: true },
    ],
    [
      'hidden draft',
      post({ status: 'draft', isHidden: true }),
      active,
      { author: true, admin: false, other: false, guest: false },
    ],
  ];

  it.each(cases)('post: %s', (_label, p, a, expected) => {
    expect({
      author: canViewPost(p, a, author),
      admin: canViewPost(p, a, admin),
      other: canViewPost(p, a, other),
      guest: canViewPost(p, a, guest),
    }).toEqual(expected);
  });

  it('treats only published, visible posts of non-deactivated authors as public', () => {
    expect(isPubliclyVisible(post(), active)).toBe(true);
    expect(isPubliclyVisible(post({ isHidden: true }), active)).toBe(false);
    expect(
      isPubliclyVisible(post(), { status: AccountStatus.SUSPENDED }),
    ).toBe(true);
  });

  describe('comments', () => {
    const commenterId = new Types.ObjectId();
    const commenter: Viewer = {
      sub: commenterId.toString(),
      role: UserRole.USER,
    };

    it('shows a visible comment to everyone who can see the post', () => {
      const comment = { authorId: commenterId, isHidden: false };
      for (const viewer of [guest, other, admin, commenter, author]) {
        expect(canViewComment(comment, post(), active, viewer)).toBe(true);
      }
    });

    it('shows a hidden comment only to its author and admins', () => {
      const comment = { authorId: commenterId, isHidden: true };
      expect(canViewComment(comment, post(), active, commenter)).toBe(true);
      expect(canViewComment(comment, post(), active, admin)).toBe(true);
      expect(canViewComment(comment, post(), active, author)).toBe(false);
      expect(canViewComment(comment, post(), active, other)).toBe(false);
      expect(canViewComment(comment, post(), active, guest)).toBe(false);
    });

    it('hides every comment of a post the viewer cannot see', () => {
      const comment = { authorId: commenterId, isHidden: false };
      expect(
        canViewComment(comment, post({ isHidden: true }), active, commenter),
      ).toBe(false);
      expect(
        canViewComment(comment, post({ status: 'draft' }), active, admin),
      ).toBe(false);
    });
  });
});
