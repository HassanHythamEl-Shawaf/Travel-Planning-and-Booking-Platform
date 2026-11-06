import { Types } from 'mongoose';

import { DefaultReviewHandler } from './default-handlers';
import { ModerationRegistry } from './moderation.registry';
import type { ModerationHandler, ModeratableContent } from './moderation.types';

describe('ModerationRegistry', () => {
  const authorId = new Types.ObjectId().toString();
  const id = new Types.ObjectId().toString();
  let userModel: { exists: jest.Mock };
  let registry: ModerationRegistry;

  const content = (extra: Partial<ModeratableContent> = {}) => ({
    id,
    type: 'review' as const,
    authorId,
    isHidden: false,
    publiclyVisible: true,
    snapshot: { excerpt: 'ok' },
    ...extra,
  });

  const owner = (found: ModeratableContent | null): ModerationHandler => ({
    find: jest.fn().mockResolvedValue(found),
    setHidden: jest.fn(),
  });

  beforeEach(() => {
    userModel = {
      exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
    };
    const connection = { collection: jest.fn() };
    registry = new ModerationRegistry(connection as never, userModel as never);
  });

  it('uses the default handler until the owner registers one', () => {
    expect(registry.get('review')).toBeInstanceOf(DefaultReviewHandler);
    const handler = owner(null);
    registry.register('review', handler);
    expect(registry.get('review')).toBe(handler);
    expect(registry.get('itinerary')).not.toBe(handler);
  });

  it('returns visible content of an active or suspended author', async () => {
    registry.register('review', owner(content()));
    await expect(registry.findVisible('review', id)).resolves.toMatchObject({
      id,
    });
    expect(userModel.exists).toHaveBeenCalledWith({
      _id: new Types.ObjectId(authorId),
      status: 'deactivated',
    });
  });

  it('returns null when the author is deactivated (D3)', async () => {
    registry.register('review', owner(content()));
    userModel.exists.mockReturnValue({
      exec: () => Promise.resolve({ _id: authorId }),
    });
    await expect(registry.findVisible('review', id)).resolves.toBeNull();
  });

  it('returns null for missing or non-public content without checking the author', async () => {
    registry.register('review', owner(null));
    await expect(registry.findVisible('review', id)).resolves.toBeNull();
    registry.register('review', owner(content({ publiclyVisible: false })));
    await expect(registry.findVisible('review', id)).resolves.toBeNull();
    expect(userModel.exists).not.toHaveBeenCalled();
  });
});
