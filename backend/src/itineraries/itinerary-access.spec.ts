import { Types } from 'mongoose';

import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { canViewItinerary } from './itinerary-access';

describe('canViewItinerary (ACC-11, ACC-12, GEN-10)', () => {
  const ownerId = new Types.ObjectId();
  const owner = { sub: ownerId.toString(), role: UserRole.USER };
  const other = { sub: new Types.ObjectId().toString(), role: UserRole.USER };
  const admin = { sub: new Types.ObjectId().toString(), role: UserRole.ADMIN };
  const active = { status: AccountStatus.ACTIVE };
  const suspended = { status: AccountStatus.SUSPENDED };
  const deactivated = { status: AccountStatus.DEACTIVATED };

  const view = (
    flags: { isPublic?: boolean; isHidden?: boolean },
    viewer: typeof owner | undefined,
    ownerAccount: { status: string } | null = active,
  ) => canViewItinerary({ ownerId, ...flags }, ownerAccount, viewer);

  it('private: owner only, admins included in the "no"', () => {
    expect(view({ isPublic: false }, owner)).toBe(true);
    expect(view({ isPublic: false }, other)).toBe(false);
    expect(view({ isPublic: false }, admin)).toBe(false);
    expect(view({ isPublic: false }, undefined)).toBe(false);
  });

  it('public: everyone, guests included', () => {
    expect(view({ isPublic: true }, undefined)).toBe(true);
    expect(view({ isPublic: true }, other)).toBe(true);
  });

  it('hidden: owner and admins only', () => {
    const hidden = { isPublic: true, isHidden: true };
    expect(view(hidden, owner)).toBe(true);
    expect(view(hidden, admin)).toBe(true);
    expect(view(hidden, other)).toBe(false);
    expect(view(hidden, undefined)).toBe(false);
  });

  it('deactivated owner: public itineraries for admins only', () => {
    expect(view({ isPublic: true }, admin, deactivated)).toBe(true);
    expect(view({ isPublic: true }, other, deactivated)).toBe(false);
    expect(view({ isPublic: true }, undefined, null)).toBe(false);
  });

  it('suspended owner: visible as normal', () => {
    expect(view({ isPublic: true }, other, suspended)).toBe(true);
  });
});
