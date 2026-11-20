import { SetMetadata } from '@nestjs/common';

export type ProviderType = 'airline' | 'hotel';

export const PROVIDER_OWNERSHIP_KEY = 'providerOwnership';

export interface ProviderOwnershipOptions {
  providerType: ProviderType;
  providerIdParam: string;
}

export const ProviderOwnership = (
  providerType: ProviderType,
  providerIdParam = 'id',
) =>
  SetMetadata(PROVIDER_OWNERSHIP_KEY, {
    providerType,
    providerIdParam,
  } satisfies ProviderOwnershipOptions);
