/**
 * Suggestion box types — mirror `app/schemas/suggestion.py` (camelCase).
 *
 * Three audiences, three shapes, deliberately not merged: a submitter's view
 * has no `internalNote` field at all, so no component can render it by
 * accident.
 */

import type { SuggestionAnonymityMode, SuggestionDisposition } from '../../../constants/enums';

/** `day` marks a timestamp truncated to protect an anonymous author. */
export type TimestampPrecision = 'exact' | 'day';

export interface ReviewerRef {
  id: string;
  name: string;
}

export interface SuggestionBoxPublic {
  id: string;
  name: string;
  description?: string | null;
  anonymityMode: SuggestionAnonymityMode;
  followUpEnabled: boolean;
}

export interface SuggestionBoxAdmin extends SuggestionBoxPublic {
  isActive: boolean;
  reviewerPositions: ReviewerRef[];
  reviewerMembers: ReviewerRef[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SuggestionBoxWrite {
  name: string;
  description?: string | null | undefined;
  anonymityMode: SuggestionAnonymityMode;
  followUpEnabled: boolean;
  isActive: boolean;
  reviewerPositionIds: string[];
  reviewerMemberIds: string[];
}

export interface ReviewerOptions {
  positions: ReviewerRef[];
  members: ReviewerRef[];
}

export interface SubmissionReceipt {
  id: string | null;
  isAnonymous: boolean;
  followUpKey: string | null;
}

export interface SuggestionAttachment {
  id: string;
  fileName: string;
  contentType: string;
  fileSize: number;
}

export interface ThreadMessage {
  id: string;
  authorRole: 'submitter' | 'reviewer';
  authorName?: string | null;
  isMine: boolean;
  body: string;
  createdAt: string;
  timestampPrecision: TimestampPrecision;
}

export interface MySuggestionSummary {
  id: string;
  boxId: string;
  boxName: string;
  title: string;
  followUpEnabled: boolean;
  disposition?: SuggestionDisposition | null;
  messageCount: number;
  createdAt: string;
}

export interface SubmitterSuggestionDetail {
  id: string | null;
  boxName: string;
  title: string;
  details: string;
  isAnonymous: boolean;
  followUpEnabled: boolean;
  disposition?: SuggestionDisposition | null;
  attachments: SuggestionAttachment[];
  messages: ThreadMessage[];
  createdAt: string;
  timestampPrecision: TimestampPrecision;
}

export interface ReviewSuggestionSummary {
  id: string;
  boxId: string;
  boxName: string;
  title: string;
  isAnonymous: boolean;
  submitterName?: string | null;
  disposition: SuggestionDisposition;
  messageCount: number;
  attachmentCount: number;
  createdAt: string;
  timestampPrecision: TimestampPrecision;
}

export interface ReviewSuggestionDetail {
  id: string;
  boxId: string;
  boxName: string;
  title: string;
  details: string;
  isAnonymous: boolean;
  submitterName?: string | null;
  followUpEnabled: boolean;
  canFollowUp: boolean;
  disposition: SuggestionDisposition;
  internalNote?: string | null;
  dispositionUpdatedByName?: string | null;
  dispositionUpdatedAt?: string | null;
  attachments: SuggestionAttachment[];
  messages: ThreadMessage[];
  createdAt: string;
  timestampPrecision: TimestampPrecision;
}

export interface ReviewSummary {
  isReviewer: boolean;
  openCount: number;
  boxes: SuggestionBoxPublic[];
}

/** Update contract: omit to leave alone, `null` clears the note. */
export interface DispositionUpdate {
  disposition?: SuggestionDisposition | undefined;
  internalNote?: string | null | undefined;
}

export type ReviewFilter = 'open' | SuggestionDisposition | '';
