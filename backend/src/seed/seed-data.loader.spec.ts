import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSeedData } from './seed-data.loader';

const REAL_DATA_DIR = join(__dirname, 'data');

const VALID_FILES: Record<string, string> = {
  'countries.csv': 'code,name,currency\nDE,Germany,EUR\n',
  'cities.csv': 'city_id,name,country_code\nfrankfurt,Frankfurt,DE\n',
  'airports.csv':
    'iata_code,name,city_id,country_code,time_zone\nFRA,Frankfurt Airport,frankfurt,DE,Europe/Berlin\n',
  'attractions.csv': 'attraction_id,name,city_id\natt-8,Römerberg,frankfurt\n',
};

describe('loadSeedData', () => {
  let tempDir: string;

  const writeData = (overrides: Record<string, string> = {}) => {
    for (const [file, text] of Object.entries({
      ...VALID_FILES,
      ...overrides,
    })) {
      writeFileSync(join(tempDir, file), text, 'utf8');
    }
  };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'seed-loader-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads the committed reference files with camelCase fields', () => {
    const data = loadSeedData(REAL_DATA_DIR);

    expect(data.headerErrors).toEqual([]);
    expect(data.countries).toHaveLength(8);
    expect(data.cities).toHaveLength(8);
    expect(data.airports).toHaveLength(8);
    expect(data.attractions).toHaveLength(8);

    expect(data.countries[0]).toEqual({
      line: 2,
      id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    expect(data.cities[3]).toEqual({
      line: 5,
      id: 'new_york',
      name: 'New York',
      countryCode: 'US',
    });
    expect(data.airports[0]).toEqual({
      line: 2,
      id: 'CAI',
      name: 'Cairo International Airport',
      cityId: 'cairo',
      countryCode: 'EG',
      timeZone: 'Africa/Cairo',
    });
    expect(data.attractions[0]).toEqual({
      line: 2,
      id: 'att-1',
      name: 'Giza Pyramids and Sphinx',
      cityId: 'cairo',
    });
  });

  it('preserves UTF-8 names', () => {
    const data = loadSeedData(REAL_DATA_DIR);

    expect(data.attractions.find((a) => a.id === 'att-8')?.name).toBe(
      'Römerberg',
    );
  });

  it('recognises the first header when the file starts with a BOM', () => {
    writeData({
      'countries.csv': '﻿code,name,currency\r\nDE,Germany,EUR\r\n',
    });

    const data = loadSeedData(tempDir);

    expect(data.headerErrors).toEqual([]);
    expect(data.countries).toEqual([
      { line: 2, id: 'DE', name: 'Germany', currency: 'EUR' },
    ]);
  });

  it('reports a wrong header set as a header error instead of throwing', () => {
    writeData({
      'airports.csv':
        'iata,name,city_id,country_code,time_zone\nFRA,Frankfurt Airport,frankfurt,DE,Europe/Berlin\n',
    });

    const data = loadSeedData(tempDir);

    expect(data.headerErrors).toHaveLength(1);
    expect(data.headerErrors[0]).toContain('airports.csv: expected headers');
    expect(data.headerErrors[0]).toContain('iata_code');
    expect(data.airports).toEqual([]);
  });

  it('throws a clear error when a file is missing', () => {
    writeData();
    rmSync(join(tempDir, 'cities.csv'));

    expect(() => loadSeedData(tempDir)).toThrow(/cities\.csv/);
  });
});
