/**
 * Suggestion box types — mirror `app/schemas/suggestion.py` (camelCase).
 *
 * Three audiences, three shapes, deliberately not merged: a submitter's view
 * has no `internalNote` field at all, so no component can render it by
 * accident.
 */

import type {
  SuggestionAnonymityMode,
  SuggestionDisposition,
  SuggestionIntakeQuestionType,
} from '../../../constants/enums';

/** `day` marks a timestamp truncated to protect an anonymous author. */
export type TimestampPrecision = 'exact' | 'day';

export interface ReviewerRef {
  id: string;
  name: string;
}

export interface IntakeOption {
  value: string;
  label: string;
  /** Choosing this option moves the submission to that box. */
  routeToBoxId?: string | null | undefined;
}

/**
 * A question a box asks on submission. The `condition*` fields are the forms
 * module's branching rule, so `getVisibleFieldIds` in `utils/formVisibility.ts`
 * decides what is shown — see `toConditionalFields`.
 */
export interface IntakeQuestion {
  /** Absent on a question not saved yet; the server assigns one. */
  id?: string | null | undefined;
  label: string;
  helpText?: string | null | undefined;
  type: SuggestionIntakeQuestionType;
  required: boolean;
  options: IntakeOption[];
  conditionQuestionId?: string | null | undefined;
  conditionOperator?: string | null | undefined;
  conditionValue?: string | null | undefined;
}

/** Which list a pick question chooses from. Mirrors `PickKind`. */
export type PickKind = 'member' | 'apparatus';

/** A member or vehicle a pick question offers: an id and a name, nothing more. */
export interface PickOption {
  id: string;
  name: string;
}

/** One answered question, labels as they read when it was answered. */
export interface IntakeAnswer {
  questionId: string;
  label: string;
  value: string;
  display: string;
}

export interface SuggestionBoxPublic {
  id: string;
  name: string;
  description?: string | null;
  anonymityMode: SuggestionAnonymityMode;
  followUpEnabled: boolean;
  /** Members can see and vote on what this box's reviewers publish. */
  publicBoardEnabled: boolean;
  /** Only routes to open boxes are included. Absent from an older server. */
  intakeQuestions?: IntakeQuestion[] | undefined;
}

export interface SuggestionBoxAdmin extends SuggestionBoxPublic {
  isActive: boolean;
  reviewerPositions: ReviewerRef[];
  reviewerMembers: ReviewerRef[];
  /** Told of new submissions; cannot read them. */
  watcherPositions: ReviewerRef[];
  watcherMembers: ReviewerRef[];
  /** What a permanent delete would destroy. */
  submissionCount: number;
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
  watcherPositionIds: string[];
  watcherMemberIds: string[];
  publicBoardEnabled: boolean;
  /** Omit to leave the box's questions as they are. */
  intakeQuestions?: IntakeQuestion[] | undefined;
}

export interface ReviewerOptions {
  positions: ReviewerRef[];
  members: ReviewerRef[];
}

export interface SubmissionReceipt {
  id: string | null;
  isAnonymous: boolean;
  followUpKey: string | null;
  /** The box it landed in, which an answer may have changed. */
  boxName?: string | null;
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

/** One step on a submission's timeline. The first is always receipt. */
export interface TimelineEntry {
  disposition: SuggestionDisposition;
  publicResponse?: string | null;
  createdAt: string;
  timestampPrecision: TimestampPrecision;
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
  /** Empty in a one-way box, where the submitter sees no status. */
  timeline: TimelineEntry[];
  intakeAnswers?: IntakeAnswer[] | undefined;
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
  /** Reached by a forward rather than as a reviewer of the box. */
  viaForward?: boolean;
}

export interface SuggestionForward {
  id: string;
  kind: 'position' | 'member';
  targetId?: string | null;
  name: string;
  forwardedByName?: string | null;
  createdAt?: string | null;
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
  /** Only the box's own reviewers forward or withdraw. */
  canForward: boolean;
  viaForward: boolean;
  forwards: SuggestionForward[];
  timeline: TimelineEntry[];
  /** The box has an idea board. */
  boardEnabled: boolean;
  /** Only the box's own reviewers publish; a forward recipient never does. */
  canPublish: boolean;
  publishedAt?: string | null;
  publishedTitle?: string | null;
  publishedSummary?: string | null;
  voteCount: number;
  intakeAnswers?: IntakeAnswer[] | undefined;
  /** The box the member submitted to, when an answer moved it here. */
  routedFromBoxName?: string | null;
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
  /** Each response is a new step; omit to add none. */
  publicResponse?: string | undefined;
}

export type ReviewFilter = 'open' | SuggestionDisposition | '';

/** A published suggestion as every member sees it: the reviewer-written copy only. */
export interface BoardEntry {
  id: string;
  boxId: string;
  boxName: string;
  title: string;
  summary: string;
  disposition: SuggestionDisposition;
  publicResponse?: string | null;
  voteCount: number;
  hasVoted: boolean;
  publishedAt: string;
}

export type BoardSort = 'top' | 'new';
