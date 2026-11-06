import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Connection, Model, Types } from 'mongoose';

import {
  AuditAction,
  AuditTargetType,
} from '../audit-logs/audit-log.constants';
import { AuditEntry, AuditLogsService } from '../audit-logs/audit-logs.service';
import type { ProviderType } from '../auth/decorators/provider-ownership.decorator';
import { Paginated, Pagination } from '../common/pagination';
import { containsInsensitive } from '../common/regex';
import {
  AdminBookingFilter,
  AdminBookingRow,
  BOOKING_DIRECTORY,
  type BookingDirectory,
} from '../integrations/booking-directory';
import {
  PROVIDER_DIRECTORY,
  type ProviderDirectory,
} from '../integrations/provider-directory';
import { ModeratorAssignmentsService } from '../moderator-assignments/moderator-assignments.service';
import { NotificationType } from '../notifications/notification.constants';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountStatus, User, UserRole } from '../users/schemas/user.schema';
import {
  AccountItemDto,
  AccountStatusResponseDto,
  CreatedModeratorDto,
  ModeratorAssignmentResponseDto,
  ProviderStatusResponseDto,
  ResetPasswordResponseDto,
} from './dto/admin-responses.dto';
import {
  CreateModeratorDto,
  ListAccountsQueryDto,
} from './dto/admin-requests.dto';

const BCRYPT_COST = 12;

const PROVIDER_LABEL: Record<ProviderType, string> = {
  airline: 'Airline',
  hotel: 'Hotel',
};

const PROVIDER_AUDIT_TARGET: Record<ProviderType, AuditTargetType> = {
  airline: AuditTargetType.AIRLINE,
  hotel: AuditTargetType.HOTEL,
};

/** Fields an admin may see; never passwordHash / refreshTokenHash. */
const ACCOUNT_FIELDS = {
  name: 1,
  email: 1,
  role: 1,
  status: 1,
  mustChangePassword: 1,
  lockUntil: 1,
  createdAt: 1,
} as const;

interface StatusTransition {
  from: AccountStatus;
  to: AccountStatus;
  set: Record<string, unknown>;
  action: AuditAction;
  notification: NotificationType;
}

const SUSPEND: StatusTransition = {
  from: AccountStatus.ACTIVE,
  to: AccountStatus.SUSPENDED,
  // Clearing the refresh hash ends every session at once: AuthGuard rejects
  // any request whose account has no refreshTokenHash (D12).
  set: { status: AccountStatus.SUSPENDED, refreshTokenHash: null },
  action: AuditAction.ACCOUNT_SUSPENDED,
  notification: NotificationType.ACCOUNT_SUSPENDED,
};

const REACTIVATE: StatusTransition = {
  from: AccountStatus.SUSPENDED,
  to: AccountStatus.ACTIVE,
  set: {
    status: AccountStatus.ACTIVE,
    failedLoginAttempts: 0,
    lockUntil: null,
  },
  action: AuditAction.ACCOUNT_REACTIVATED,
  notification: NotificationType.ACCOUNT_REACTIVATED,
};

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Administration (ACC-13 – ACC-17, ACC-07a). Every state change writes an
 * audit entry (GEN-07); notifications (GEN-01) are sent last and never fail
 * the request.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly assignments: ModeratorAssignmentsService,
    private readonly auditLogs: AuditLogsService,
    private readonly notifications: NotificationsService,
    @Inject(PROVIDER_DIRECTORY) private readonly providers: ProviderDirectory,
    @Inject(BOOKING_DIRECTORY) private readonly bookings: BookingDirectory,
  ) {}

  // ---------------------------------------------------------------- ACC-13

  async createModerator(
    adminId: string,
    dto: CreateModeratorDto,
  ): Promise<CreatedModeratorDto> {
    const label = PROVIDER_LABEL[dto.providerType];
    const provider = await this.providers.find(
      dto.providerType,
      dto.providerId,
    );
    if (!provider) throw new NotFoundException(`${label} not found`);
    if (!provider.isActive) {
      throw new ConflictException(
        `${label} is deactivated; reactivate it before assigning moderators`,
      );
    }

    if (await this.userModel.exists({ email: dto.email })) {
      throw new ConflictException('Email is already registered');
    }

    // Hash outside the transaction: bcrypt is slow and the callback may retry.
    const passwordHash = await bcrypt.hash(dto.temporaryPassword, BCRYPT_COST);
    const now = new Date();

    try {
      return await this.connection.transaction(async (session) => {
        const [user] = await this.userModel.create(
          [
            {
              name: dto.name,
              email: dto.email,
              passwordHash,
              role: UserRole.MODERATOR,
              status: AccountStatus.ACTIVE,
              mustChangePassword: true,
              termsAcceptedAt: now,
              privacyPolicyAcceptedAt: now,
            },
          ],
          { session },
        );
        const moderatorId = user._id.toString();

        const assignment = await this.assignments.create(
          {
            moderatorId,
            providerType: dto.providerType,
            providerId: dto.providerId,
            assignedBy: adminId,
          },
          session,
        );

        await this.auditLogs.record(
          {
            actorId: adminId,
            action: AuditAction.MODERATOR_CREATED,
            targetType: AuditTargetType.USER,
            targetId: moderatorId,
            details: {
              email: dto.email,
              providerType: dto.providerType,
              providerId: dto.providerId,
            },
          },
          session,
        );

        return {
          id: moderatorId,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
          assignment: {
            providerType: assignment.providerType,
            providerId: assignment.providerId,
            assignedBy: assignment.assignedBy,
            createdAt: assignment.createdAt,
          },
        };
      });
    } catch (error) {
      // Two admins creating the same email at once: the unique index wins.
      if (isDuplicateKeyError(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- ACC-14

  async listAccounts(
    query: ListAccountsQueryDto,
    page: Pagination,
  ): Promise<Paginated<AccountItemDto>> {
    const filter: Record<string, unknown> = {};
    if (query.role) filter.role = query.role;
    if (query.status) filter.status = query.status;
    const search = query.search?.trim();
    if (search) {
      const matcher = containsInsensitive(search);
      filter.$or = [{ name: matcher }, { email: matcher }];
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(filter, ACCOUNT_FIELDS)
        .sort({ createdAt: -1, _id: -1 })
        .skip(page.skip)
        .limit(page.limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(filter).exec(),
    ]);

    const moderatorIds = users
      .filter((u) => u.role === UserRole.MODERATOR)
      .map((u) => u._id.toString());
    const assignmentsById =
      await this.assignments.findByModeratorIds(moderatorIds);

    return {
      items: users.map((u) => {
        const assignment = assignmentsById.get(u._id.toString());
        return {
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          mustChangePassword: u.mustChangePassword ?? false,
          lockUntil: u.lockUntil ?? null,
          createdAt: u.createdAt,
          assignment: assignment
            ? {
                providerType: assignment.providerType,
                providerId: assignment.providerId,
              }
            : null,
        };
      }),
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    };
  }

  // -------------------------------------------------------- ACC-15, ACC-16

  suspendAccount(adminId: string, targetId: string, reason?: string) {
    return this.changeAccountStatus(adminId, targetId, SUSPEND, reason);
  }

  reactivateAccount(adminId: string, targetId: string, reason?: string) {
    return this.changeAccountStatus(adminId, targetId, REACTIVATE, reason);
  }

  private async changeAccountStatus(
    adminId: string,
    targetId: string,
    transition: StatusTransition,
    reason?: string,
  ): Promise<AccountStatusResponseDto> {
    const target = await this.findNonAdminTarget(
      targetId,
      transition === SUSPEND
        ? 'Administrator accounts cannot be suspended'
        : 'Administrator accounts cannot be reactivated',
    );

    if (target.status !== transition.from) {
      throw new ConflictException(
        statusConflictMessage(transition, target.status),
      );
    }

    // Conditional on the expected status, so of two concurrent requests
    // exactly one succeeds and the other gets 409.
    const result = await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(targetId), status: transition.from },
        { $set: transition.set },
      )
      .exec();
    if (result.modifiedCount === 0) {
      const current = await this.userModel
        .findById(targetId, { status: 1 })
        .lean()
        .exec();
      throw new ConflictException(
        statusConflictMessage(transition, current?.status ?? transition.to),
      );
    }

    await this.recordAudit({
      actorId: adminId,
      action: transition.action,
      targetType: AuditTargetType.USER,
      targetId,
      details: { role: target.role, reason: reason ?? null },
    });
    await this.notifications.send(
      targetId,
      transition.notification,
      reason ? { reason } : {},
    );

    return { id: targetId, status: transition.to };
  }

  // --------------------------------------------------------------- ACC-07a

  async resetPassword(
    adminId: string,
    targetId: string,
    temporaryPassword: string,
  ): Promise<ResetPasswordResponseDto> {
    const target = await this.findNonAdminTarget(
      targetId,
      'Administrator passwords cannot be reset by an administrator',
    );
    if (target.status === AccountStatus.DEACTIVATED) {
      throw new ConflictException('Account is deactivated');
    }

    const passwordHash = await bcrypt.hash(temporaryPassword, BCRYPT_COST);
    const result = await this.userModel
      .updateOne(
        {
          _id: new Types.ObjectId(targetId),
          role: { $ne: UserRole.ADMIN },
          status: { $ne: AccountStatus.DEACTIVATED },
        },
        {
          $set: {
            passwordHash,
            mustChangePassword: true,
            refreshTokenHash: null,
            failedLoginAttempts: 0,
            lockUntil: null,
          },
        },
      )
      .exec();
    if (result.matchedCount === 0) {
      throw new ConflictException('Account is deactivated');
    }

    await this.recordAudit({
      actorId: adminId,
      action: AuditAction.PASSWORD_RESET_BY_ADMIN,
      targetType: AuditTargetType.USER,
      targetId,
      details: { role: target.role },
    });
    await this.notifications.send(
      targetId,
      NotificationType.PASSWORD_RESET_BY_ADMIN,
    );

    return { id: targetId, mustChangePassword: true };
  }

  // ---------------------------------------------------------------- ACC-15

  async setProviderActive(
    adminId: string,
    providerType: ProviderType,
    providerId: string,
    active: boolean,
  ): Promise<ProviderStatusResponseDto> {
    const label = PROVIDER_LABEL[providerType];
    const updated = await this.providers.setActive(
      providerType,
      providerId,
      active,
    );
    if (!updated) {
      const existing = await this.providers.find(providerType, providerId);
      if (!existing) throw new NotFoundException(`${label} not found`);
      throw new ConflictException(
        active
          ? `${label} is already active`
          : `${label} is already deactivated`,
      );
    }

    const [moderatorIds, travellerIds] = await Promise.all([
      this.assignments.findModeratorIdsForProvider(providerType, providerId),
      this.bookings.findUserIdsWithUpcomingConfirmedBookings(
        providerType,
        providerId,
      ),
    ]);
    const recipients = [...new Set([...moderatorIds, ...travellerIds])];

    await this.recordAudit({
      actorId: adminId,
      action: active
        ? AuditAction.PROVIDER_REACTIVATED
        : AuditAction.PROVIDER_DEACTIVATED,
      targetType: PROVIDER_AUDIT_TARGET[providerType],
      targetId: providerId,
      details: { providerName: updated.name, notifiedUsers: recipients.length },
    });
    await this.notifications.sendMany(
      recipients,
      active
        ? NotificationType.PROVIDER_REACTIVATED
        : NotificationType.PROVIDER_DEACTIVATED,
      { providerType, providerId, providerName: updated.name },
    );

    return {
      providerType,
      providerId,
      isActive: updated.isActive,
      notifiedUsers: recipients.length,
    };
  }

  // ---------------------------------------------------------------- ACC-17

  listBookings(
    filter: AdminBookingFilter,
    page: Pagination,
  ): Promise<Paginated<AdminBookingRow>> {
    return this.bookings.listAll(filter, page);
  }

  // ------------------------------------------------------- moderator (D23)

  async getModeratorAssignment(
    moderatorId: string,
  ): Promise<ModeratorAssignmentResponseDto> {
    const assignment = await this.assignments.findByModeratorId(moderatorId);
    if (!assignment) {
      throw new NotFoundException('No provider is assigned to this account');
    }
    const provider = await this.providers.find(
      assignment.providerType,
      assignment.providerId,
    );
    return {
      providerType: assignment.providerType,
      providerId: assignment.providerId,
      providerName: provider?.name ?? null,
      isActive: provider?.isActive ?? false,
    };
  }

  // --------------------------------------------------------------- helpers

  /** 404 if missing; 403 for admin accounts, which also covers the caller (D13). */
  private async findNonAdminTarget(targetId: string, adminMessage: string) {
    const target = await this.userModel
      .findById(targetId, { role: 1, status: 1 })
      .lean()
      .exec();
    if (!target) throw new NotFoundException('Account not found');
    if (target.role === UserRole.ADMIN) {
      throw new ForbiddenException(adminMessage);
    }
    return target;
  }

  /**
   * For actions outside a transaction the state change is already applied;
   * a failed audit write is logged loudly and surfaces as 500.
   */
  private async recordAudit(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.record(entry);
    } catch (error) {
      this.logger.error(
        `Audit write failed after ${entry.action} on ${entry.targetType} ${entry.targetId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new InternalServerErrorException(
        'The action was applied but its audit entry could not be recorded',
      );
    }
  }
}

function statusConflictMessage(
  transition: StatusTransition,
  current: AccountStatus,
): string {
  if (current === AccountStatus.DEACTIVATED) {
    return 'Account is deactivated';
  }
  return transition === SUSPEND
    ? 'Account is already suspended'
    : 'Account is not suspended';
}
