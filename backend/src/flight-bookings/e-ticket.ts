import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';

import { PassengerType, SegmentDirection } from './flight-booking.constants';
import type {
  FlightBooking,
  FlightPassenger,
  FlightSegment,
} from './schemas/flight-booking.schema';

/** What an e-ticket shows: a Confirmed (or Completed) booking and its airline names. */
export interface ETicketInput {
  booking: Pick<
    FlightBooking,
    | 'bookingReference'
    | 'status'
    | 'tripType'
    | 'segments'
    | 'passengers'
    | 'baseFare'
    | 'baggageFees'
    | 'totalPrice'
    | 'currency'
    | 'confirmedAt'
  >;
  /** Airline name by airline id (string). */
  airlineNames: Readonly<Record<string, string>>;
}

export interface ETicketOptions {
  /** Compressed by default; tests turn it off to read the text. */
  compress?: boolean;
}

const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';
const RULE = '#d1d5db';
const PAGE_MARGIN = 50;

/** FLT-23 / GEN-06: flight times always in each airport's own time zone. */
export function localDateTime(at: Date, zone: string): string {
  return DateTime.fromJSDate(at)
    .setZone(zone)
    .toFormat('ccc d LLL yyyy, HH:mm');
}

/** Shows only the last 4 characters of a passport or ID number. */
export function maskDocument(documentNumber: string): string {
  const visible = documentNumber.slice(-4);
  return `${'*'.repeat(Math.max(0, documentNumber.length - 4))}${visible}`;
}

function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

/**
 * FLT-23: renders the e-ticket as a PDF. Pure apart from pdfkit, so it is
 * tested without a database. Uses the built-in Helvetica fonts, which
 * cover Latin text.
 */
export function renderETicket(
  { booking, airlineNames }: ETicketInput,
  options: ETicketOptions = {},
): Promise<Buffer> {
  const reference = booking.bookingReference ?? '';
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: {
      Title: `E-ticket ${reference}`,
      Subject: `Flight booking ${reference}`,
      Author: 'Travel Planning and Booking Platform',
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - PAGE_MARGIN * 2;
  const rule = () => {
    doc
      .moveDown(0.6)
      .strokeColor(RULE)
      .lineWidth(1)
      .moveTo(PAGE_MARGIN, doc.y)
      .lineTo(PAGE_MARGIN + width, doc.y)
      .stroke()
      .moveDown(0.6);
  };
  const heading = (text: string) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor(ACCENT)
      .text(text.toUpperCase());
    doc.moveDown(0.3);
  };

  // Header
  doc
    .font('Helvetica-Bold')
    .fontSize(22)
    .fillColor(INK)
    .text('Flight E-Ticket');
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(10).fillColor(MUTED).text('Booking reference');
  doc.font('Helvetica-Bold').fontSize(26).fillColor(ACCENT).text(reference, {
    characterSpacing: 3,
  });
  doc.moveDown(0.2);
  const issued = booking.confirmedAt
    ? DateTime.fromJSDate(booking.confirmedAt)
        .toUTC()
        .toFormat('d LLL yyyy, HH:mm') + ' UTC'
    : '-';
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(INK)
    .text(
      `Status: ${booking.status}    Trip: ${booking.tripType === 'round-trip' ? 'Round trip' : 'One way'}    Issued: ${issued}`,
    );
  rule();

  // Flights
  heading('Flights');
  booking.segments.forEach((segment, index) => {
    renderSegment(
      doc,
      segment,
      airlineNames[segment.airlineId.toString()] ?? '',
    );
    if (index < booking.segments.length - 1) doc.moveDown(0.8);
  });
  rule();

  // Passengers
  heading('Passengers');
  renderPassengers(doc, booking.passengers, booking.currency, width);
  rule();

  // Price
  heading('Price');
  const priceRow = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 12 : 10)
      .fillColor(INK);
    doc.text(label, PAGE_MARGIN, y, { width: width / 2 });
    doc.text(value, PAGE_MARGIN + width / 2, y, {
      width: width / 2,
      align: 'right',
    });
    doc.moveDown(0.2);
  };
  priceRow('Base fare', money(booking.baseFare, booking.currency));
  priceRow('Extra baggage', money(booking.baggageFees, booking.currency));
  priceRow('Total paid', money(booking.totalPrice, booking.currency), true);
  rule();

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      "All times are local to each airport. Please carry the passport or ID used for this booking. Infants travel on an adult's lap without a seat.",
      PAGE_MARGIN,
      doc.y,
      { width },
    );

  doc.end();
  return done;
}

function renderSegment(
  doc: PDFKit.PDFDocument,
  segment: FlightSegment,
  airlineName: string,
): void {
  const label =
    segment.direction === SegmentDirection.RETURN ? 'Return' : 'Outbound';
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(INK)
    .text(
      `${label}  ·  ${segment.flightNumber}${airlineName ? `  ·  ${airlineName}` : ''}`,
    );
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(10).fillColor(INK);
  doc.text(
    `Depart  ${segment.departureAirportCode}   ${localDateTime(segment.departureAt, segment.departureTimeZone)}  (${segment.departureTimeZone})`,
  );
  doc.text(
    `Arrive  ${segment.arrivalAirportCode}   ${localDateTime(segment.arrivalAt, segment.arrivalTimeZone)}  (${segment.arrivalTimeZone})`,
  );
  doc
    .fillColor(MUTED)
    .text(
      `Cabin: ${segment.cabinCategory}    Free baggage: ${segment.freeBaggageAllowance} bag(s) per passenger, up to ${segment.maxWeightPerBagKg} kg each`,
    );
}

function renderPassengers(
  doc: PDFKit.PDFDocument,
  passengers: readonly FlightPassenger[],
  currency: string,
  width: number,
): void {
  const columns = [
    { title: 'Name', share: 0.3 },
    { title: 'Type', share: 0.18 },
    { title: 'Passport / ID', share: 0.18 },
    { title: 'Extra bags', share: 0.14 },
    { title: 'Amount', share: 0.2, align: 'right' as const },
  ];
  const row = (cells: string[], bold: boolean) => {
    const y = doc.y;
    let x = PAGE_MARGIN;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(9.5)
      .fillColor(bold ? MUTED : INK);
    let bottom = y;
    columns.forEach((column, i) => {
      const columnWidth = width * column.share;
      // A gap between columns, except after the last one so it lines up
      // with the right-aligned price totals below.
      const gap = i === columns.length - 1 ? 0 : 6;
      doc.text(cells[i], x, y, {
        width: columnWidth - gap,
        align: column.align ?? 'left',
      });
      bottom = Math.max(bottom, doc.y);
      x += columnWidth;
    });
    doc.x = PAGE_MARGIN;
    doc.y = bottom + 4;
  };

  row(
    columns.map((c) => c.title),
    true,
  );
  for (const passenger of passengers) {
    const bags =
      passenger.extraBags > 0
        ? `${passenger.extraBags} (${passenger.extraBaggageWeightKg} kg)`
        : '-';
    const type =
      passenger.type === PassengerType.INFANT
        ? 'Infant (no seat)'
        : passenger.type;
    row(
      [
        passenger.fullName,
        type,
        maskDocument(passenger.documentNumber),
        bags,
        money(passenger.fare + passenger.baggageFee, currency),
      ],
      false,
    );
  }
}
