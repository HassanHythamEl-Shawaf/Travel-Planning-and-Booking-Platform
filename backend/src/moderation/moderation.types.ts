import type { ClientSession } from 'mongoose';

/** Content that can be reported (GEN-09) and moderated (GEN-10). */
export const CONTENT_TYPES = ['post', 'comment', 'review', 'itinerary'] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** Enum-like object for ParseEnumPipe and Swagger. */
export const CONTENT_TYPE_ENUM = {
  post: 'post',
  comment: 'comment',
  review: 'review',
  itinerary: 'itinerary',
} as const satisfies Record<ContentType, ContentType>;

export const EXCERPT_LENGTH = 200;

export interface ContentSnapshot {
  title?: string;
  /** First 200 characters of the content's text. */
  excerpt: string;
}

export interface ModeratableContent {
  id: string;
  type: ContentType;
  authorId: string;
  isHidden: boolean;
  /**
   * True when a non-author, non-admin could see it right now (published /
   * public, parent visible). Author status is checked by the registry, not here.
   */
  publiclyVisible: boolean;
  snapshot: ContentSnapshot;
}

export interface ModerationHandler {
  find(
    id: string,
    session?: ClientSession,
  ): Promise<ModeratableContent | null>;
  /**
   * Conditional: matches only if isHidden !== hidden. Returns false if not
   * found or already in that state.
   */
  setHidden(
    id: string,
    hidden: boolean,
    session: ClientSession,
  ): Promise<boolean>;
  /** Optional. Returns false if not found. */
  delete?(id: string, session: ClientSession): Promise<boolean>;
}

/** First `EXCERPT_LENGTH` characters, never splitting a surrogate pair. */
export function toExcerpt(text: unknown): string {
  if (typeof text !== 'string') return '';
  return Array.from(text).slice(0, EXCERPT_LENGTH).join('');
}
