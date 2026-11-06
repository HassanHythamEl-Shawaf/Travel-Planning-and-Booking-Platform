import { POST_STATUS } from '../integrations/teammate-contracts';

/** Blog limits (BLG-01 – BLG-12). See docs/requirements/BLG-blog-spec.md. */
export const POST_TITLE_MIN = 3;
export const POST_TITLE_MAX = 150;
export const POST_CONTENT_MAX = 20_000;

/** BLG-05 in the requirements sheet: non-empty, max 500 characters. */
export const COMMENT_MAX = 500;

/** BLG-08: up to 5 tags of at most 30 characters. */
export const TAGS_MAX = 5;
export const TAG_MAX_LENGTH = 30;
export const TAG_PATTERN = /^[a-z0-9-]+$/;

export const SEARCH_QUERY_MAX = 100;

/** GEN-08: up to 5 images per post. */
export const POST_IMAGES_MAX = 5;

/** BLG-12: public itineraries shown on an author page. */
export const AUTHOR_ITINERARIES_MAX = 10;

export type PostStatus = (typeof POST_STATUS)[keyof typeof POST_STATUS];

export const POST_STATUSES = Object.values(POST_STATUS) as PostStatus[];

/** Name shown for content whose author deactivated their account (D12). */
export const DELETED_USER_NAME = 'Deleted user';

/** resolutionNote on reports closed because the author deleted the content (D6). */
export const DELETED_BY_AUTHOR_NOTE = 'Deleted by author';
