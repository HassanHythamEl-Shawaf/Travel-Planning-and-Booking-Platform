import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';

import { getPagination } from '../common/pagination';
import { AuditAction, AuditTargetType } from './audit-log.constants';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  const actorId = new Types.ObjectId();
  let find: {
    sort: jest.Mock;
    skip: jest.Mock;
    limit: jest.Mock;
    lean: jest.Mock;
  };
  let auditModel: {
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
  };
  let userModel: { find: jest.Mock };
  let service: AuditLogsService;

  beforeEach(() => {
    const docs = [
      {
        _id: new Types.ObjectId(),
        actorId,
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetType: AuditTargetType.USER,
        targetId: 'target',
        details: { role: 'user' },
        createdAt: new Date('2026-11-02'),
      },
    ];
    find = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnValue({ exec: () => Promise.resolve(docs) }),
    };
    auditModel = {
      create: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockReturnValue(find),
      countDocuments: jest
        .fn()
        .mockReturnValue({ exec: () => Promise.resolve(1) }),
    };
    userModel = {
      find: jest.fn().mockReturnValue({
        lean: () => ({
          exec: () => Promise.resolve([{ _id: actorId, name: 'Admin' }]),
        }),
      }),
    };
    service = new AuditLogsService(auditModel as never, userModel as never);
  });

  it('records an entry inside the given session', async () => {
    const session = {} as never;
    await service.record(
      {
        actorId: actorId.toString(),
        action: AuditAction.MODERATOR_CREATED,
        targetType: AuditTargetType.USER,
        targetId: 'x',
        details: { email: 'm@example.com' },
      },
      session,
    );
    const [[entry], options] = auditModel.create.mock.calls[0];
    expect(options).toEqual({ session });
    expect(entry.details).toEqual({ email: 'm@example.com' });
    expect(entry.actorId.toString()).toBe(actorId.toString());
  });

  it('strips password and token keys from details', async () => {
    await service.record({
      actorId: actorId.toString(),
      action: AuditAction.PASSWORD_RESET_BY_ADMIN,
      targetType: AuditTargetType.USER,
      targetId: 'x',
      details: {
        temporaryPassword: 'secret1',
        passwordHash: 'h',
        refreshToken: 't',
        role: 'user',
      },
    });
    expect(auditModel.create.mock.calls[0][0][0].details).toEqual({
      role: 'user',
    });
  });

  it('propagates write failures (an admin action must not lose its audit entry)', async () => {
    auditModel.create.mockRejectedValue(new Error('write failed'));
    await expect(
      service.record({
        actorId: actorId.toString(),
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetType: AuditTargetType.USER,
        targetId: 'x',
      }),
    ).rejects.toThrow('write failed');
  });

  it('applies every filter and sorts newest first', async () => {
    const from = new Date('2026-11-01');
    const to = new Date('2026-11-30');
    const result = await service.list(
      {
        action: AuditAction.ACCOUNT_SUSPENDED,
        actorId: actorId.toString(),
        targetType: AuditTargetType.USER,
        from,
        to,
      },
      getPagination(2),
    );

    const query = auditModel.find.mock.calls[0][0];
    expect(query).toMatchObject({
      action: AuditAction.ACCOUNT_SUSPENDED,
      targetType: AuditTargetType.USER,
      createdAt: { $gte: from, $lte: to },
    });
    expect(query.actorId.toString()).toBe(actorId.toString());
    expect(find.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(find.skip).toHaveBeenCalledWith(10);
    expect(result.items[0]).toMatchObject({
      actorId: actorId.toString(),
      actorName: 'Admin',
      targetId: 'target',
    });
    expect(result.total).toBe(1);
  });

  it('uses an empty filter when none is given', async () => {
    await service.list({}, getPagination(1));
    expect(auditModel.find.mock.calls[0][0]).toEqual({});
  });

  it('rejects from > to', async () => {
    await expect(
      service.list(
        { from: new Date('2026-12-01'), to: new Date('2026-11-01') },
        getPagination(1),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
