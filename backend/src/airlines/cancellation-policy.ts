import type { CancellationTier } from './schemas/airline.schema';

/**
 * Selects the highest applicable threshold. Person 7 can use this pure helper
 * without depending on the airline controller or persistence layer.
 */
export function calculateRefundPercentage(
  tiers: readonly Pick<CancellationTier, 'daysBeforeDeparture' | 'refundPercentage'>[],
  daysRemaining: number,
): number {
  return tiers
    .filter((tier) => tier.daysBeforeDeparture <= daysRemaining)
    .sort((left, right) => right.daysBeforeDeparture - left.daysBeforeDeparture)
    .at(0)?.refundPercentage ?? 0;
}
