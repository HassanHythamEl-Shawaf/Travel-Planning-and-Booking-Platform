import {
  formatTotals,
  itineraryPdfFileName,
  pdfSafe,
  renderItineraryPdf,
} from './itinerary-pdf';
import type { ItineraryView, Totals } from './itinerary-view';

const none = (): Totals => ({ amounts: [] });
const egp = (amount: number, converted?: number): Totals => ({
  amounts: [{ currency: 'EGP', amount }],
  ...(converted === undefined ? {} : { converted }),
});

function view(overrides: Partial<ItineraryView> = {}): ItineraryView {
  return {
    id: '6650f1c2a1b2c3d4e5f60718',
    title: 'Nile week',
    countries: [{ code: 'EG', name: 'Egypt' }],
    startDate: '2026-12-01',
    endDate: '2026-12-02',
    dayCount: 2,
    isPublic: true,
    isHidden: false,
    isOwner: false,
    author: { id: 'a1', name: 'Mona' },
    clonedFrom: null,
    days: [
      {
        id: 'd1',
        dayNumber: 1,
        date: '2026-12-01',
        cityId: '1',
        cityName: 'Cairo',
        notes: 'Arrive early',
        activities: [
          {
            id: 'x1',
            name: 'Pyramids',
            description: 'Giza plateau',
            time: '09:00',
            cost: 500,
            currency: 'EGP',
            images: [],
          },
        ],
        budgetEntries: [
          {
            id: 'b1',
            category: 'food',
            amount: 250,
            currency: 'EGP',
            note: 'Koshary',
          },
        ],
      },
      {
        id: 'd2',
        dayNumber: 2,
        date: '2026-12-02',
        cityId: '2',
        cityName: 'Luxor',
        notes: '',
        activities: [],
        budgetEntries: [],
      },
    ],
    cityGroups: [],
    transportEntries: [
      {
        id: 't1',
        dayId: 'd2',
        dayNumber: 2,
        mode: 'train',
        fromCityId: '1',
        fromCityName: 'Cairo',
        toCityId: '2',
        toCityName: 'Luxor',
        amount: 750,
        currency: 'EGP',
        note: '',
      },
    ],
    budget: {
      byCategory: {
        food: egp(250, 5),
        accommodation: none(),
        in_city_transport: none(),
        activities: egp(500, 10),
        intercity_transport: egp(750, 15),
      },
      byDay: [],
      total: egp(1500, 30),
      conversion: {
        currency: 'USD',
        rateDate: '2026-11-17',
        usingCachedRates: false,
      },
    },
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

/** The text drawn on the pages: pdfkit writes it as hex strings in TJ arrays. */
function drawnText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  return [...raw.matchAll(/\[(.*?)\] TJ/g)]
    .map(([, parts]) =>
      [...parts.matchAll(/<([0-9a-f]*)>/g)]
        .map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');
}

describe('itinerary PDF (ITN-28)', () => {
  it('renders a valid PDF titled with the itinerary title', async () => {
    const pdf = await renderItineraryPdf(view(), { compress: false });
    const raw = pdf.toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(raw).toContain('(Nile week)');
  });

  it('shows the days, activities, budget, transport and conversion', async () => {
    const text = drawnText(
      await renderItineraryPdf(view(), { compress: false }),
    );

    for (const expected of [
      'Nile week',
      'Author: Mona',
      'Countries: Egypt',
      'Day 1',
      'Cairo',
      'Arrive early',
      '09:00',
      'Pyramids',
      '500.00 EGP',
      'Koshary',
      'Day 2',
      'Luxor',
      'train, Cairo to Luxor',
      '750.00 EGP',
      'Intercity transport',
      '1500.00 EGP',
      '(= 30.00 USD)',
      'rates of 2026-11-17',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('still renders, without conversion, when no rates are available', async () => {
    const plain = view();
    plain.budget.conversion = null;
    plain.budget.conversionError = 'Exchange rates are unavailable';
    for (const totals of Object.values(plain.budget.byCategory)) {
      delete totals.converted;
    }
    delete plain.budget.total.converted;

    const text = drawnText(
      await renderItineraryPdf(plain, { compress: false }),
    );
    expect(text).toContain('Not converted: Exchange rates are unavailable');
    expect(text).not.toContain('(= ');
  });

  it('credits the original author of a clone (ITN-21)', async () => {
    const clone = view({
      clonedFrom: { itineraryId: 'o1', author: { id: 'a2', name: 'Karim' } },
    });
    const text = drawnText(
      await renderItineraryPdf(clone, { compress: false }),
    );
    expect(text).toContain('Cloned from an itinerary by Karim');
  });

  it('does not crash on text the built-in fonts cannot draw', async () => {
    const pdf = await renderItineraryPdf(view({ title: 'رحلة Cairo' }), {
      compress: false,
    });
    expect(pdf.toString('latin1').startsWith('%PDF-')).toBe(true);
    expect(drawnText(pdf)).toContain('???? Cairo');
  });

  it('is compressed by default', async () => {
    const [compressed, plain] = await Promise.all([
      renderItineraryPdf(view()),
      renderItineraryPdf(view(), { compress: false }),
    ]);
    expect(compressed.length).toBeLessThan(plain.length);
  });
});

describe('PDF helpers', () => {
  it('keeps Western European text and replaces the rest with "?"', () => {
    expect(pdfSafe('Café – €5 “ok”')).toBe('Café – €5 “ok”');
    expect(pdfSafe('東京 trip')).toBe('?? trip');
    expect(pdfSafe('a\tb')).toBe('a?b');
  });

  it('formats totals per currency, with the converted value', () => {
    expect(formatTotals(none(), 'USD')).toBe('-');
    expect(
      formatTotals(
        {
          amounts: [
            { currency: 'EGP', amount: 120 },
            { currency: 'USD', amount: 30 },
          ],
          converted: 32.4,
        },
        'USD',
      ),
    ).toBe('120.00 EGP + 30.00 USD  (= 32.40 USD)');
    expect(formatTotals(egp(10, 0.2))).toBe('10.00 EGP');
  });

  it('names the file after the id, never the title', () => {
    expect(itineraryPdfFileName('6650f1c2a1b2c3d4e5f60718')).toBe(
      'itinerary-6650f1c2a1b2c3d4e5f60718.pdf',
    );
  });
});
