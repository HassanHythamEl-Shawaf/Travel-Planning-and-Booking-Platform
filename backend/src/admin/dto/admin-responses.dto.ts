import { ApiProperty } from '@nestjs/swagger';

import type { ProviderType } from '../../auth/decorators/provider-ownership.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import {
  BOOKING_STATUS,
  type BookingType,
} from '../../integrations/teammate-contracts';
import { PROVIDER_TYPES } from '../../moderator-assignments/schemas/moderator-assignment.schema';
import { AccountStatus, UserRole } from '../../users/schemas/user.schema';

const ID = '6650f1c2a1b2c3d4e5f60718';

export class AssignmentSummaryDto {
  @ApiProperty({ enum: PROVIDER_TYPES })
  providerType: ProviderType;

  @ApiProperty({ example: ID })
  providerId: string;
}

export class CreatedAssignmentDto extends AssignmentSummaryDto {
  @ApiProperty({ example: ID, description: 'Admin who created it' })
  assignedBy: string;

  @ApiProperty()
  createdAt: Date;
}

export class CreatedModeratorDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Nour Hassan' })
  name: string;

  @ApiProperty({ example: 'nour.moderator@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole, example: UserRole.MODERATOR })
  role: UserRole;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.ACTIVE })
  status: AccountStatus;

  @ApiProperty({ example: true })
  mustChangePassword: boolean;

  @ApiProperty({ type: CreatedAssignmentDto })
  assignment: CreatedAssignmentDto;
}

export class AccountItemDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: 'Sara Ali' })
  name: string;

  @ApiProperty({ example: 'sara@example.com' })
  email: string;

  @ApiProperty({ enum: UserRole })
  role: UserRole;

  @ApiProperty({ enum: AccountStatus })
  status: AccountStatus;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty({ type: Date, nullable: true })
  lockUntil: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({
    type: AssignmentSummaryDto,
    nullable: true,
    description: 'Set for moderators only',
  })
  assignment: AssignmentSummaryDto | null;
}

export class PaginatedAccountsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AccountItemDto] })
  items: AccountItemDto[];
}

export class AccountStatusResponseDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ enum: AccountStatus })
  status: AccountStatus;
}

export class ResetPasswordResponseDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ example: true })
  mustChangePassword: true;
}

export class ProviderStatusResponseDto {
  @ApiProperty({ enum: PROVIDER_TYPES })
  providerType: ProviderType;

  @ApiProperty({ example: ID })
  providerId: string;

  @ApiProperty({ example: false })
  isActive: boolean;

  @ApiProperty({
    example: 4,
    description: 'Moderators plus users with upcoming confirmed bookings',
  })
  notifiedUsers: number;
}

export class AdminBookingItemDto {
  @ApiProperty({ example: ID })
  id: string;

  @ApiProperty({ enum: ['flight', 'hotel'] })
  type: BookingType;

  @ApiProperty({ example: 'TRV-8K2Q1Z', nullable: true, type: String })
  bookingReference: string | null;

  @ApiProperty({ enum: Object.values(BOOKING_STATUS) })
  status: string;

  @ApiProperty({ example: ID })
  userId: string;

  @ApiProperty({ example: 'Sara Ali', nullable: true, type: String })
  userName: string | null;

  @ApiProperty({ example: 'sara@example.com', nullable: true, type: String })
  userEmail: string | null;

  @ApiProperty({
    example: ID,
    nullable: true,
    type: String,
    description: 'Airline id for flights, hotel id for hotels',
  })
  providerId: string | null;

  @ApiProperty({ example: 420.5, nullable: true, type: Number })
  totalPrice: number | null;

  @ApiProperty({ example: 'EGP', nullable: true, type: String })
  currency: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class PaginatedAdminBookingsDto extends PaginatedResponseDto {
  @ApiProperty({ type: [AdminBookingItemDto] })
  items: AdminBookingItemDto[];
}

export class ModeratorAssignmentResponseDto extends AssignmentSummaryDto {
  @ApiProperty({ example: 'Nile Air', nullable: true, type: String })
  providerName: string | null;

  @ApiProperty({
    example: true,
    description: 'False while an admin has deactivated the provider',
  })
  isActive: boolean;
}
