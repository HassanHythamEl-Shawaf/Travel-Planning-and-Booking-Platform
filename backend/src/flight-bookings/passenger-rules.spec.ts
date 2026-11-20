import { PassengerType } from './flight-booking.constants';
import {
  ageOnDate,
  compositionError,
  countPassengers,
  fareForPassenger,
  occupiesSeat,
  passengerTypeForAge,
  roundMoney,
} from './passenger-rules';

const { ADULT, CHILD, INFANT } = PassengerType;

describe('passenger rules (FLT-12, FLT-19)', () => {
  describe('ageOnDate', () => {
    it('counts whole years and treats the birthday as reached', () => {
      expect(ageOnDate('2014-06-15', '2026-06-14')).toBe(11);
      expect(ageOnDate('2014-06-15', '2026-06-15')).toBe(12);
    });

    it('handles a 29 February birthday', () => {
      expect(ageOnDate('2024-02-29', '2026-02-28')).toBe(1);
      expect(ageOnDate('2024-02-29', '2026-03-01')).toBe(2);
    });

    it('rejects invalid dates and births after travel', () => {
      expect(ageOnDate('not-a-date', '2026-06-15')).toBeNull();
      expect(ageOnDate('2026-06-16', '2026-06-15')).toBeNull();
    });

    it('accepts a newborn travelling on the birth date', () => {
      expect(ageOnDate('2026-06-15', '2026-06-15')).toBe(0);
    });
  });

  it.each([
    [0, INFANT],
    [1, INFANT],
    [2, CHILD],
    [11, CHILD],
    [12, ADULT],
    [80, ADULT],
  ])('age %i is %s', (age, type) => {
    expect(passengerTypeForAge(age)).toBe(type);
  });

  it('gives seats to adults and children only', () => {
    expect(occupiesSeat(ADULT)).toBe(true);
    expect(occupiesSeat(CHILD)).toBe(true);
    expect(occupiesSeat(INFANT)).toBe(false);
    expect(countPassengers([ADULT, CHILD, INFANT])).toEqual({
      adults: 1,
      children: 1,
      infants: 1,
      seats: 2,
    });
  });

  describe('compositionError', () => {
    it('accepts one adult with one infant', () => {
      expect(compositionError(countPassengers([ADULT, INFANT]))).toBeNull();
    });

    it('requires at least one adult', () => {
      expect(compositionError(countPassengers([CHILD, CHILD]))).toMatch(
        /at least one adult/,
      );
    });

    it('rejects more infants than adults', () => {
      expect(
        compositionError(countPassengers([ADULT, INFANT, INFANT])),
      ).toMatch(/more infants than adults/);
    });
  });

  it('charges infants 10% of the fare and rounds to cents', () => {
    expect(fareForPassenger(ADULT, 199.99)).toBe(199.99);
    expect(fareForPassenger(CHILD, 199.99)).toBe(199.99);
    expect(fareForPassenger(INFANT, 199.99)).toBe(20);
    expect(fareForPassenger(INFANT, 123.45)).toBe(12.35);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});
