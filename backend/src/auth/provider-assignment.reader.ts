import { ProviderType } from './decorators/provider-ownership.decorator';

export const PROVIDER_ASSIGNMENT_READER = Symbol('PROVIDER_ASSIGNMENT_READER');

export interface ModeratorAssignment {
  moderatorId: string;
  providerType: ProviderType;
  providerId: string;
}

export interface ProviderAssignmentReader {
  findByModeratorId(moderatorId: string): Promise<ModeratorAssignment | null>;
}
