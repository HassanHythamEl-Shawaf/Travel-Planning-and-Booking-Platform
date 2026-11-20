import { calculateRefundPercentage } from './cancellation-policy';

describe('calculateRefundPercentage', () => {
  const tiers = [
    { daysBeforeDeparture: 30, refundPercentage: 75 },
    { daysBeforeDeparture: 7, refundPercentage: 25 },
    { daysBeforeDeparture: 0, refundPercentage: 0 },
  ];

  it('uses the highest threshold not exceeding days remaining', () => {
    expect(calculateRefundPercentage(tiers, 10)).toBe(25);
    expect(calculateRefundPercentage(tiers, 45)).toBe(75);
  });

  it('returns zero when no tier applies', () => {
    expect(
      calculateRefundPercentage(
        [{ daysBeforeDeparture: 30, refundPercentage: 75 }],
        10,
      ),
    ).toBe(0);
  });
});
