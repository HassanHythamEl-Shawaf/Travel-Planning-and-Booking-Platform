import { BadRequestException } from '@nestjs/common';

import { TAG_MAX_LENGTH, TAG_PATTERN, TAGS_MAX } from './blog.constants';

/**
 * One tag as stored and searched (D10): trimmed, lowercased, 1–30
 * characters of a–z, 0–9 and "-". Throws 400 otherwise.
 */
export function normalizeTag(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new BadRequestException('Tags must be strings');
  }
  const tag = raw.trim().toLowerCase();
  if (tag.length === 0 || tag.length > TAG_MAX_LENGTH) {
    throw new BadRequestException(
      `Each tag must be 1–${TAG_MAX_LENGTH} characters`,
    );
  }
  if (!TAG_PATTERN.test(tag)) {
    throw new BadRequestException(
      'Tags may contain only letters, digits and "-"',
    );
  }
  return tag;
}

/** Normalises and deduplicates, then enforces the maximum of 5 (BLG-08). */
export function normalizeTags(raw: unknown[]): string[] {
  const tags = [...new Set(raw.map(normalizeTag))];
  if (tags.length > TAGS_MAX) {
    throw new BadRequestException(`A post can have at most ${TAGS_MAX} tags`);
  }
  return tags;
}
