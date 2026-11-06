import {
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { AuditAction } from '../audit-logs/audit-log.constants';
import { getPagination } from '../common/pagination';
import { NotificationType } from '../notifications/notification.constants';
import { AccountStatus, UserRole } from '../users/schemas/user.schema';
import { AdminService } from './admin.service';
import { CreateModeratorDto } from './dto/admin-requests.dto';

const exec = (value: unknown) => ({ exec: () => Promise.resolve(value) });
const leanExec = (value: unknown) => ({ lean: () => exec(value) });

describe('AdminService', () => {
  const adminId = new Types.ObjectId().toString();
  const targetId = new Types.ObjectId().toString();
  const providerId = new Types.ObjectId().toString();
  const session = { id: 'session' };

  let connection: { transaction: jest.Mock };
  let userModel: Record<string, jest.Mock>;
  let assignments: Record<string, jest.Mock>;
  let auditLogs: { record: jest.Mock };
  let notifications: { send: jest.Mock; sendMany: jest.Mock };
  let providers: { find: jest.Mock; setActive: jest.Mock };
  let bookings: Record<string, jest.Mock>;
  let service: AdminService;

  const activeProvider = {
    id: providerId,
    type: 'airline',
    name: 'Nile Air',
    isActive: true,
  };

  const dto: CreateModeratorDto = {
    name: 'Nour',
    email: 'nour@example.com',
    temporaryPassword: 'tmp-SECRET-pw',
    providerType: 'airline',
    providerId,
  };

  beforeEach(() => {
    connection = {
      transaction: jest.fn(async (fn: (s: unknown) => unknown) => fn(session)),
    };
    userModel = {
      exists: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockImplementation(([doc]) =>
          Promise.resolve([{ ...doc, _id: new Types.ObjectId(targetId) }]),
        ),
      findById: jest.fn(),
      updateOne: jest
        .fn()
        .mockReturnValue(exec({ modifiedCount: 1, matchedCount: 1 })),
      find: jest.fn(),
      countDocuments: jest.fn().mockReturnValue(exec(0)),
    };
    assignments = {
      create: jest
        .fn()
        .mockImplementation((input) =>
          Promise.resolve({ ...input, createdAt: new Date('2026-11-05') }),
        ),
      findByModeratorIds: jest.fn().mockResolvedValue(new Map()),
      findModeratorIdsForProvider: jest.fn().mockResolvedValue([]),
      findByModeratorId: jest.fn(),
    };
    auditLogs = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = {
      send: jest.fn().mockResolvedValue(undefined),
      sendMany: jest.fn().mockResolvedValue(undefined),
    };
    providers = {
      find: jest.fn().mockResolvedValue(activeProvider),
      setActive: jest.fn(),
    };
    bookings = {
      findUserIdsWithUpcomingConfirmedBookings: jest.fn().mockResolvedValue([]),
      listAll: jest.fn(),
    };
    service = new AdminService(
      connection as never,
      userModel as never,
      assignments as never,
      auditLogs as never,
      notifications as never,
      providers as never,
      bookings as never,
    );
  });

  const target = (role: UserRole, status: AccountStatus) =>
    userModel.findById.mockReturnValue(
      leanExec({ _id: targetId, role, status }),
    );

  describe('createModerator (ACC-13)', () => {
    it('creates user, assignment and audit entry in one transaction', async () => {
      const result = await service.createModerator(adminId, dto);

      expect(connection.transaction).toHaveBeenCalledTimes(1);
      const [[userDoc], userOptions] = userModel.create.mock.calls[0];
      expect(userOptions).toEqual({ session });
      expect(userDoc).toMatchObject({
        role: UserRole.MODERATOR,
        status: AccountStatus.ACTIVE,
        mustChangePassword: true,
      });
      expect(userDoc.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(userDoc.termsAcceptedAt).toBeInstanceOf(Date);
      expect(userDoc.privacyPolicyAcceptedAt).toBeInstanceOf(Date);

      expect(assignments.create).toHaveBeenCalledWith(
        {
          moderatorId: targetId,
          providerType: 'airline',
          providerId,
          assignedBy: adminId,
        },
        session,
      );
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.MODERATOR_CREATED,
          targetId,
          details: { email: dto.email, providerType: 'airline', providerId },
        }),
        session,
      );
      expect(result).toMatchObject({
        id: targetId,
        role: UserRole.MODERATOR,
        mustChangePassword: true,
        assignment: {
          providerType: 'airline',
          providerId,
          assignedBy: adminId,
        },
      });
    });

    it('never returns or audits the temporary password or its hash', async () => {
      const result = await service.createModerator(adminId, dto);
      const leaked = JSON.stringify([result, auditLogs.record.mock.calls]);
      expect(leaked).not.toContain(dto.temporaryPassword);
      expect(leaked).not.toMatch(/passwordHash|\$2[aby]\$/);
    });

    it('404s for a missing provider, naming its type', async () => {
      providers.find.mockResolvedValue(null);
      await expect(service.createModerator(adminId, dto)).rejects.toThrow(
        new NotFoundException('Airline not found'),
      );
      await expect(
        service.createModerator(adminId, { ...dto, providerType: 'hotel' }),
      ).rejects.toThrow('Hotel not found');
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('409s for a deactivated provider', async () => {
      providers.find.mockResolvedValue({ ...activeProvider, isActive: false });
      await expect(
        service.createModerator(adminId, dto),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('409s for an email that is already registered', async () => {
      userModel.exists.mockResolvedValue({ _id: targetId });
      await expect(service.createModerator(adminId, dto)).rejects.toThrow(
        'Email is already registered',
      );
      expect(connection.transaction).not.toHaveBeenCalled();
    });

    it('maps a racing duplicate-key error to 409', async () => {
      userModel.create.mockRejectedValue(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );
      await expect(service.createModerator(adminId, dto)).rejects.toThrow(
        new ConflictException('Email is already registered'),
      );
    });

    it('aborts the transaction when the assignment insert fails', async () => {
      let aborted = false;
      connection.transaction.mockImplementation(
        async (fn: (s: unknown) => unknown) => {
          try {
            return await fn(session);
          } catch (error) {
            aborted = true; // mongoose aborts, discarding the user insert
            throw error;
          }
        },
      );
      assignments.create.mockRejectedValue(
        new Error('assignment insert failed'),
      );

      await expect(service.createModerator(adminId, dto)).rejects.toThrow(
        'assignment insert failed',
      );
      expect(aborted).toBe(true);
      expect(userModel.create.mock.calls[0][1]).toEqual({ session });
      expect(auditLogs.record).not.toHaveBeenCalled();
    });
  });

  describe('suspend / reactivate (ACC-15, ACC-16)', () => {
    it('suspends an active user, clearing the refresh token', async () => {
      target(UserRole.USER, AccountStatus.ACTIVE);

      await expect(
        service.suspendAccount(adminId, targetId, 'Spam'),
      ).resolves.toEqual({ id: targetId, status: AccountStatus.SUSPENDED });

      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(filter.status).toBe(AccountStatus.ACTIVE);
      expect(update.$set).toEqual({
        status: AccountStatus.SUSPENDED,
        refreshTokenHash: null,
      });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.ACCOUNT_SUSPENDED,
          details: { role: UserRole.USER, reason: 'Spam' },
        }),
      );
      expect(notifications.send).toHaveBeenCalledWith(
        targetId,
        NotificationType.ACCOUNT_SUSPENDED,
        { reason: 'Spam' },
      );
    });

    it('suspends a moderator without touching the assignment', async () => {
      target(UserRole.MODERATOR, AccountStatus.ACTIVE);
      await service.suspendAccount(adminId, targetId);
      for (const mock of Object.values(assignments)) {
        expect(mock).not.toHaveBeenCalled();
      }
    });

    it('reactivates a suspended account and clears the lockout', async () => {
      target(UserRole.USER, AccountStatus.SUSPENDED);
      await expect(
        service.reactivateAccount(adminId, targetId),
      ).resolves.toEqual({ id: targetId, status: AccountStatus.ACTIVE });
      expect(userModel.updateOne.mock.calls[0][1].$set).toEqual({
        status: AccountStatus.ACTIVE,
        failedLoginAttempts: 0,
        lockUntil: null,
      });
      expect(notifications.send).toHaveBeenCalledWith(
        targetId,
        NotificationType.ACCOUNT_REACTIVATED,
        {},
      );
    });

    it('404s for an unknown account', async () => {
      userModel.findById.mockReturnValue(leanExec(null));
      await expect(
        service.suspendAccount(adminId, targetId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('403s for an admin target, including the caller', async () => {
      target(UserRole.ADMIN, AccountStatus.ACTIVE);
      await expect(
        service.suspendAccount(adminId, targetId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.suspendAccount(adminId, adminId),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it.each([
      ['suspend', AccountStatus.SUSPENDED, 'Account is already suspended'],
      ['suspend', AccountStatus.DEACTIVATED, 'Account is deactivated'],
      ['reactivate', AccountStatus.ACTIVE, 'Account is not suspended'],
      ['reactivate', AccountStatus.DEACTIVATED, 'Account is deactivated'],
    ])('%s from %s is 409', async (action, status, message) => {
      target(UserRole.USER, status);
      const call =
        action === 'suspend'
          ? service.suspendAccount(adminId, targetId)
          : service.reactivateAccount(adminId, targetId);
      await expect(call).rejects.toThrow(new ConflictException(message));
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('409s when a concurrent request changed the status first', async () => {
      userModel.updateOne.mockReturnValue(exec({ modifiedCount: 0 }));
      userModel.findById
        .mockReturnValueOnce(
          leanExec({
            _id: targetId,
            role: UserRole.USER,
            status: AccountStatus.ACTIVE,
          }),
        )
        .mockReturnValueOnce(leanExec({ status: AccountStatus.SUSPENDED }));

      await expect(service.suspendAccount(adminId, targetId)).rejects.toThrow(
        'Account is already suspended',
      );
      expect(auditLogs.record).not.toHaveBeenCalled();
      expect(notifications.send).not.toHaveBeenCalled();
    });

    it('returns 500 when the audit write fails after the change', async () => {
      target(UserRole.USER, AccountStatus.ACTIVE);
      auditLogs.record.mockRejectedValue(new Error('down'));
      await expect(
        service.suspendAccount(adminId, targetId),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(notifications.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword (ACC-07a)', () => {
    it.each([AccountStatus.ACTIVE, AccountStatus.SUSPENDED])(
      'resets a %s account without changing its status',
      async (status) => {
        target(UserRole.MODERATOR, status);
        await expect(
          service.resetPassword(adminId, targetId, 'tmp-SECRET-pw'),
        ).resolves.toEqual({ id: targetId, mustChangePassword: true });

        const update = userModel.updateOne.mock.calls[0][1].$set;
        expect(update).toMatchObject({
          mustChangePassword: true,
          refreshTokenHash: null,
          failedLoginAttempts: 0,
          lockUntil: null,
        });
        expect(update.status).toBeUndefined();
        expect(update.passwordHash).toMatch(/^\$2[aby]\$12\$/);
        expect(JSON.stringify(auditLogs.record.mock.calls)).not.toContain(
          'tmp-SECRET-pw',
        );
        expect(auditLogs.record.mock.calls[0][0].action).toBe(
          AuditAction.PASSWORD_RESET_BY_ADMIN,
        );
        expect(notifications.send).toHaveBeenCalledWith(
          targetId,
          NotificationType.PASSWORD_RESET_BY_ADMIN,
        );
      },
    );

    it('403s for an admin target', async () => {
      target(UserRole.ADMIN, AccountStatus.ACTIVE);
      await expect(
        service.resetPassword(adminId, targetId, 'x'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('409s for a deactivated account', async () => {
      target(UserRole.USER, AccountStatus.DEACTIVATED);
      await expect(
        service.resetPassword(adminId, targetId, 'x'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s for an unknown account', async () => {
      userModel.findById.mockReturnValue(leanExec(null));
      await expect(
        service.resetPassword(adminId, targetId, 'x'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('setProviderActive (ACC-15)', () => {
    it('deactivates and notifies moderators and travellers once each', async () => {
      const shared = new Types.ObjectId().toString();
      const moderator = new Types.ObjectId().toString();
      const traveller = new Types.ObjectId().toString();
      providers.setActive.mockResolvedValue({
        ...activeProvider,
        isActive: false,
      });
      assignments.findModeratorIdsForProvider.mockResolvedValue([
        moderator,
        shared,
      ]);
      bookings.findUserIdsWithUpcomingConfirmedBookings.mockResolvedValue([
        shared,
        traveller,
      ]);

      await expect(
        service.setProviderActive(adminId, 'airline', providerId, false),
      ).resolves.toEqual({
        providerType: 'airline',
        providerId,
        isActive: false,
        notifiedUsers: 3,
      });

      const [recipients, type, payload] = notifications.sendMany.mock.calls[0];
      expect([...recipients].sort()).toEqual(
        [moderator, shared, traveller].sort(),
      );
      expect(type).toBe(NotificationType.PROVIDER_DEACTIVATED);
      expect(payload).toEqual({
        providerType: 'airline',
        providerId,
        providerName: 'Nile Air',
      });
      expect(auditLogs.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.PROVIDER_DEACTIVATED,
          targetType: 'airline',
          details: { providerName: 'Nile Air', notifiedUsers: 3 },
        }),
      );
    });

    it('reactivates with the matching audit action and notification', async () => {
      providers.setActive.mockResolvedValue(activeProvider);
      await service.setProviderActive(adminId, 'airline', providerId, true);
      expect(providers.setActive).toHaveBeenCalledWith(
        'airline',
        providerId,
        true,
      );
      expect(auditLogs.record.mock.calls[0][0].action).toBe(
        AuditAction.PROVIDER_REACTIVATED,
      );
      expect(notifications.sendMany.mock.calls[0][1]).toBe(
        NotificationType.PROVIDER_REACTIVATED,
      );
    });

    it('404s for a missing provider', async () => {
      providers.setActive.mockResolvedValue(null);
      providers.find.mockResolvedValue(null);
      await expect(
        service.setProviderActive(adminId, 'hotel', providerId, false),
      ).rejects.toThrow(new NotFoundException('Hotel not found'));
    });

    it('409s when already in the requested state', async () => {
      providers.setActive.mockResolvedValue(null);
      await expect(
        service.setProviderActive(adminId, 'airline', providerId, true),
      ).rejects.toThrow(new ConflictException('Airline is already active'));
      expect(notifications.sendMany).not.toHaveBeenCalled();
    });
  });

  describe('listAccounts (ACC-14)', () => {
    let query: Record<string, jest.Mock>;

    beforeEach(() => {
      const moderatorId = new Types.ObjectId();
      query = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnValue(
          exec([
            {
              _id: moderatorId,
              name: 'M',
              email: 'm@x.io',
              role: UserRole.MODERATOR,
              status: AccountStatus.ACTIVE,
            },
            {
              _id: new Types.ObjectId(),
              name: 'U',
              email: 'u@x.io',
              role: UserRole.USER,
              status: AccountStatus.ACTIVE,
            },
          ]),
        ),
      };
      userModel.find.mockReturnValue(query);
      assignments.findByModeratorIds.mockResolvedValue(
        new Map([
          [moderatorId.toString(), { providerType: 'hotel', providerId: 'h1' }],
        ]),
      );
    });

    it('escapes the search text so it matches literally', async () => {
      await service.listAccounts({ search: 'a.b*' }, getPagination(1));
      const filter = userModel.find.mock.calls[0][0];
      const matchers = filter.$or.map(
        (clause: Record<string, RegExp>) => Object.values(clause)[0],
      );
      for (const matcher of matchers) {
        expect(matcher.flags).toContain('i');
        expect(matcher.test('xA.B*y')).toBe(true);
        expect(matcher.test('aXbbb')).toBe(false);
      }
    });

    it('filters by role and status, never selecting secrets', async () => {
      await service.listAccounts(
        { role: UserRole.MODERATOR, status: AccountStatus.SUSPENDED },
        getPagination(1),
      );
      const [filter, projection] = userModel.find.mock.calls[0];
      expect(filter).toEqual({
        role: UserRole.MODERATOR,
        status: AccountStatus.SUSPENDED,
      });
      expect(projection).not.toHaveProperty('passwordHash');
      expect(projection).not.toHaveProperty('refreshTokenHash');
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    });

    it('attaches assignments to moderator rows with one $in lookup', async () => {
      const result = await service.listAccounts({}, getPagination(1));
      expect(assignments.findByModeratorIds).toHaveBeenCalledTimes(1);
      expect(assignments.findByModeratorIds.mock.calls[0][0]).toHaveLength(1);
      expect(result.items[0].assignment).toEqual({
        providerType: 'hotel',
        providerId: 'h1',
      });
      expect(result.items[1].assignment).toBeNull();
    });
  });

  describe('getModeratorAssignment', () => {
    it('404s without an assignment', async () => {
      assignments.findByModeratorId.mockResolvedValue(null);
      await expect(
        service.getModeratorAssignment(targetId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the provider name and active flag', async () => {
      assignments.findByModeratorId.mockResolvedValue({
        providerType: 'airline',
        providerId,
      });
      await expect(service.getModeratorAssignment(targetId)).resolves.toEqual({
        providerType: 'airline',
        providerId,
        providerName: 'Nile Air',
        isActive: true,
      });
    });
  });
});
