import { Types } from 'mongoose';

import { CabinCategory } from '../airlines/schemas/flight.schema';
import { localDateTime, maskDocument, renderETicket } from './e-ticket';
import type { ETicketInput } from './e-ticket';
import {
  PassengerType,
  SegmentDirection,
  TripType,
} from './flight-booking.constants';

const airlineId = new Types.ObjectId();

function input(): ETicketInput {
  return {
    airlineNames: { [airlineId.toString()]: 'Nile Air' },
    booking: {
      bookingReference: 'K7QM2X',
      status: 'Confirmed',
      tripType: TripType.ONE_WAY,
      segments: [
        {
          direction: SegmentDirection.OUTBOUND,
          flightId: new Types.ObjectId(),
          airlineId,
          flightNumber: 'NA101',
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'LHR',
          departureAt: new Date('2026-12-01T06:00:00Z'),
          arrivalAt: new Date('2026-12-01T11:00:00Z'),
          departureTimeZone: 'Africa/Cairo',
          arrivalTimeZone: 'Europe/London',
          cabinId: new Types.ObjectId(),
          cabinCategory: CabinCategory.ECONOMY,
          cabinFare: 200,
          freeBaggageAllowance: 1,
          maxWeightPerBagKg: 23,
          pricePerExtraBag: 50,
          maxExtraBagsPerPassenger: 2,
          seats: 1,
          holdId: 'h',
        },
      ],
      passengers: [
        {
          fullName: 'Sara Hassan',
          dateOfBirth: new Date('1990-05-05'),
          documentNumber: 'A12345678',
          type: PassengerType.ADULT,
          extraBags: 1,
          extraBaggageWeightKg: 20,
          fare: 200,
          baggageFee: 50,
        },
      ],
      baseFare: 200,
      baggageFees: 50,
      totalPrice: 250,
      currency: 'USD',
      confirmedAt: new Date('2026-11-10T18:04:00Z'),
    },
  };
}

describe('e-ticket PDF (FLT-23)', () => {
  it('renders a one-page PDF titled with the booking reference', async () => {
    const pdf = await renderETicket(input(), { compress: false });
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('(E-ticket K7QM2X)');
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it('is compressed by default', async () => {
    const [compressed, plain] = await Promise.all([
      renderETicket(input()),
      renderETicket(input(), { compress: false }),
    ]);
    expect(compressed.length).toBeLessThan(plain.length);
  });

  it('shows flight times in each airport’s local time (GEN-06)', () => {
    const departure = new Date('2026-12-01T06:00:00Z');
    expect(localDateTime(departure, 'Africa/Cairo')).toBe(
      'Tue 1 Dec 2026, 08:00',
    );
    expect(localDateTime(departure, 'Europe/London')).toBe(
      'Tue 1 Dec 2026, 06:00',
    );
  });

  it('masks all but the last 4 characters of the document number', () => {
    expect(maskDocument('A12345678')).toBe('*****5678');
    expect(maskDocument('XY9')).toBe('XY9');
  });
});
