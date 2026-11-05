import { Types } from 'mongoose';

import type { ProviderDirectory } from '../integrations/provider-directory';
import { MongoModeratorAssignmentReader } from './moderator-assignment.reader';

function mockFindOne(result: unknown) {
  return jest.fn().mockReturnValue({
    lean: () => ({ exec: () => Promise.resolve(result) }),
  });
}

describe('MongoModeratorAssignmentReader', () => {
  const moderatorId = new Types.ObjectId();
  const providerId = new Types.ObjectId();
  const assignment = {
    moderatorId,
    providerType: 'airline',
    providerId,
    assignedBy: new Types.ObjectId(),
  };

  let model: { findOne: jest.Mock };
  let providers: jest.Mocked<ProviderDirectory>;
  let reader: MongoModeratorAssignmentReader;

  beforeEach(() => {
    model = { findOne: mockFindOne(assignment) };
    providers = {
      find: jest.fn().mockResolvedValue({
        id: providerId.toString(),
        type: 'airline',
        name: 'Test Air',
        isActive: true,
      }),
      setActive: jest.fn(),
    };
    reader = new MongoModeratorAssignmentReader(model as never, providers);
  });

  it('returns null for an invalid moderator id without querying', async () => {
    await expect(reader.findByModeratorId('not-an-id')).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });

  it('returns null when there is no assignment', async () => {
    model.findOne = mockFindOne(null);
    await expect(
      reader.findByModeratorId(moderatorId.toString()),
    ).resolves.toBeNull();
    expect(providers.find).not.toHaveBeenCalled();
  });

  it('returns null when the provider no longer exists', async () => {
    providers.find.mockResolvedValue(null);
    await expect(
      reader.findByModeratorId(moderatorId.toString()),
    ).resolves.toBeNull();
  });

  it('returns null when the provider is deactivated', async () => {
    providers.find.mockResolvedValue({
      id: providerId.toString(),
      type: 'airline',
      name: 'Test Air',
      isActive: false,
    });
    await expect(
      reader.findByModeratorId(moderatorId.toString()),
    ).resolves.toBeNull();
  });

  it('returns the assignment with string ids', async () => {
    const result = await reader.findByModeratorId(moderatorId.toString());

    expect(result).toEqual({
      moderatorId: moderatorId.toString(),
      providerType: 'airline',
      providerId: providerId.toString(),
    });
    expect(typeof result?.providerId).toBe('string');
    expect(providers.find).toHaveBeenCalledWith(
      'airline',
      providerId.toString(),
    );
  });
});
