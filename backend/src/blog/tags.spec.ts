import { BadRequestException } from '@nestjs/common';

import { normalizeTag, normalizeTags } from './tags';

describe('Tags (BLG-08, D10)', () => {
  it('trims, lowercases and deduplicates', () => {
    expect(normalizeTags(['Cairo ', 'cairo', ' NILE-cruise'])).toEqual([
      'cairo',
      'nile-cruise',
    ]);
  });

  it('accepts 5 tags and rejects 6', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e'])).toHaveLength(5);
    expect(() => normalizeTags(['a', 'b', 'c', 'd', 'e', 'f'])).toThrow(
      BadRequestException,
    );
  });

  it('counts the limit after deduplication', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'A '])).toHaveLength(5);
  });

  it('accepts 30 characters and rejects 31 or empty', () => {
    expect(normalizeTag('a'.repeat(30))).toBe('a'.repeat(30));
    expect(() => normalizeTag('a'.repeat(31))).toThrow(BadRequestException);
    expect(() => normalizeTag('   ')).toThrow(BadRequestException);
  });

  it('rejects characters outside a–z, 0–9 and "-"', () => {
    for (const bad of ['new york', 'café', 'a.b', '#travel', 'a_b']) {
      expect(() => normalizeTag(bad)).toThrow(BadRequestException);
    }
  });

  it('rejects non-strings', () => {
    expect(() => normalizeTag(5)).toThrow(BadRequestException);
  });
});
