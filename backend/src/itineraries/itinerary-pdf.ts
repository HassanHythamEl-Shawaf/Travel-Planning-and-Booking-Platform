import PDFDocument from 'pdfkit';

import type { BudgetLine, ItineraryView, Totals } from './itinerary-view';
import { BUDGET_LINES } from './itinerary-view';

/**
 * ITN-28 (bonus): export or print an itinerary as a PDF.
 *
 * Renders the same view as GET /api/itineraries/:id (days, activities,
 * budget entries, transport, city groups, totals and the ITN-18 conversion),
 * so the PDF can never show something the viewer could not see on screen.
 * Pure apart from pdfkit, so it is tested without a database, like the
 * FLT-23 e-ticket (flight-bookings/e-ticket.ts).
 */

export interface ItineraryPdfOptions {
  /** Compressed by default; tests turn it off to read the text. */
  compress?: boolean;
}

const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#1d4ed8';
const RULE = '#d1d5db';
const PAGE_MARGIN = 50;

export const LINE_LABELS: Record<BudgetLine, string> = {
  food: 'Food',
  accommodation: 'Accommodation',
  in_city_transport: 'In-city transport',
  activities: 'Activities',
  intercity_transport: 'Intercity transport',
};

/** Characters outside Latin-1 that the built-in WinAnsi fonts can still draw. */
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/**
 * The built-in Helvetica fonts only cover Western European text (WinAnsi).
 * Other characters (e.g. Arabic) would come out as wrong letters, so they
 * are shown as "?" instead. A known limit, documented in the ITN-28 spec.
 */
export function pdfSafe(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const printable = (code >= 0x20 && code <= 0x7e) || code >= 0xa0;
    out +=
      char === '\n' ||
      (printable && (code <= 0xff || WIN_ANSI_EXTRAS.has(char)))
        ? char
        : '?';
  }
  return out;
}

function money(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

/** "120.00 EGP + 30.00 USD", or "-" when there is nothing. */
export function formatTotals(totals: Totals, displayCurrency?: string): string {
  const original = totals.amounts.length
    ? totals.amounts.map((m) => money(m.amount, m.currency)).join(' + ')
    : '-';
  const converted =
    displayCurrency && totals.converted != null && totals.amounts.length
      ? `  (= ${money(totals.converted, displayCurrency)})`
      : '';
  return original + converted;
}

/** File name for the download: never the user's title (header safety). */
export function itineraryPdfFileName(id: string): string {
  return `itinerary-${id}.pdf`;
}

export function renderItineraryPdf(
  view: ItineraryView,
  options: ItineraryPdfOptions = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: {
      Title: pdfSafe(view.title),
      Subject: 'Travel itinerary',
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
  const display = view.budget.conversion?.currency;
  const write = (
    text: string,
    { font = 'Helvetica', size = 10, color = INK } = {},
  ) => {
    doc
      .font(font)
      .fontSize(size)
      .fillColor(color)
      .text(pdfSafe(text), PAGE_MARGIN, doc.y, { width });
  };
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
    write(text.toUpperCase(), {
      font: 'Helvetica-Bold',
      size: 12,
      color: ACCENT,
    });
    doc.moveDown(0.3);
  };
  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc
      .font(bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(bold ? 11 : 10)
      .fillColor(INK);
    doc.text(pdfSafe(label), PAGE_MARGIN, y, { width: width * 0.4 });
    const labelBottom = doc.y;
    doc.text(pdfSafe(value), PAGE_MARGIN + width * 0.4, y, {
      width: width * 0.6,
      align: 'right',
    });
    doc.y = Math.max(labelBottom, doc.y);
    doc.moveDown(0.15);
  };

  // Header
  write(view.title, { font: 'Helvetica-Bold', size: 20 });
  doc.moveDown(0.3);
  const dates =
    view.startDate && view.endDate
      ? `${view.startDate} to ${view.endDate}`
      : (view.startDate ?? '-');
  write(
    `${dates}  ·  ${view.dayCount} day(s)  ·  ${view.isPublic ? 'Public' : 'Private'}`,
    { color: MUTED },
  );
  write(
    `Countries: ${view.countries.map((c) => c.name ?? c.code).join(', ') || '-'}`,
  );
  write(`Author: ${view.author.name}`);
  if (view.clonedFrom) {
    write(`Cloned from an itinerary by ${view.clonedFrom.author.name}`, {
      color: MUTED,
    });
  }
  rule();

  // City groups (ITN-09)
  if (view.cityGroups.length) {
    heading('Route');
    for (const group of view.cityGroups) {
      const days =
        group.firstDayNumber === group.lastDayNumber
          ? `Day ${group.firstDayNumber}`
          : `Days ${group.firstDayNumber}-${group.lastDayNumber}`;
      row(
        `${days}: ${group.cityName ?? group.cityId} (${group.dayCount} day(s))`,
        formatTotals(group.subtotal, display),
      );
    }
    rule();
  }

  // Days (ITN-05, ITN-10, ITN-14)
  heading('Days');
  if (!view.days.length) write('No days yet.', { color: MUTED });
  for (const day of view.days) {
    write(
      `Day ${day.dayNumber}${day.date ? `  ·  ${day.date}` : ''}  ·  ${day.cityName ?? day.cityId}`,
      { font: 'Helvetica-Bold', size: 11 },
    );
    if (day.notes) write(day.notes, { color: MUTED });
    for (const activity of day.activities) {
      const cost =
        activity.cost !== null && activity.currency
          ? `  ·  ${money(activity.cost, activity.currency)}`
          : '';
      write(
        `${activity.time ? `${activity.time}  ` : ''}${activity.name}${cost}`,
      );
      if (activity.description) {
        write(`    ${activity.description}`, { size: 9, color: MUTED });
      }
    }
    for (const entry of day.budgetEntries) {
      write(
        `Budget: ${LINE_LABELS[entry.category]}  ·  ${money(entry.amount, entry.currency)}${entry.note ? `  ·  ${entry.note}` : ''}`,
        { size: 9.5, color: MUTED },
      );
    }
    doc.moveDown(0.5);
  }

  // Transport (ITN-16)
  if (view.transportEntries.length) {
    rule();
    heading('Intercity transport');
    for (const entry of view.transportEntries) {
      row(
        `Day ${entry.dayNumber ?? '-'}: ${entry.mode}, ${entry.fromCityName ?? entry.fromCityId} to ${entry.toCityName ?? entry.toCityId}`,
        money(entry.amount, entry.currency),
      );
    }
  }
  rule();

  // Budget (ITN-14, ITN-18)
  heading('Budget');
  for (const line of BUDGET_LINES) {
    row(LINE_LABELS[line], formatTotals(view.budget.byCategory[line], display));
  }
  row('Total', formatTotals(view.budget.total, display), true);
  doc.moveDown(0.3);
  const conversion = view.budget.conversion;
  if (conversion) {
    write(
      `Converted to ${conversion.currency} at the rates of ${conversion.rateDate}${conversion.usingCachedRates ? ' (last cached rates; the rate service was unavailable)' : ''}.`,
      { size: 8.5, color: MUTED },
    );
  } else if (view.budget.conversionError) {
    write(`Not converted: ${view.budget.conversionError}`, {
      size: 8.5,
      color: MUTED,
    });
  }

  doc.end();
  return done;
}
