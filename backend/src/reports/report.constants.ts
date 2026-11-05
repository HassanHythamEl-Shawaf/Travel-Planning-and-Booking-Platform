/** Why a user reports content (GEN-09, D4). */
export enum ReportReason {
  SPAM = 'spam',
  HARASSMENT = 'harassment',
  INAPPROPRIATE = 'inappropriate',
  MISINFORMATION = 'misinformation',
  OTHER = 'other',
}

/** `open` moves once to a terminal state and never changes again (D7). */
export enum ReportStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  CONTENT_HIDDEN = 'content_hidden',
  CONTENT_DELETED = 'content_deleted',
}

export const REPORT_DETAILS_MAX = 500;
