/**
 * Shift history import — wire types.
 *
 * snake_case, matching `backend/app/schemas/shift_history_import.py`, which
 * (like the rest of the scheduling module) carries no camelCase alias
 * generator. Times are UTC ISO strings; the review screens render them in the
 * import's own time zone, not the viewer's, because that is the zone the file
 * was written in and the one the reviewer is checking against.
 */

export const HistoryImportStatus = {
  DRAFT: 'draft',
  COMMITTED: 'committed',
} as const;
export type HistoryImportStatus = (typeof HistoryImportStatus)[keyof typeof HistoryImportStatus];

export interface HistoryImportCommitSummary {
  shifts_created: number;
  shifts_updated: number;
  attendance_created: number;
  external_hours_created: number;
  members_created: number;
  agencies_created: number;
  external_units_created: number;
  duplicates_skipped: number;
  rows_skipped: number;
  rows_excluded: number;
}

export interface HistoryImportSummary {
  id: string;
  status: HistoryImportStatus;
  source_filename: string;
  timezone: string;
  row_count: number;
  created_by?: string | null;
  committed_by?: string | null;
  created_at?: string | null;
  committed_at?: string | null;
  summary?: Partial<HistoryImportCommitSummary> | null;
}

export interface HistoryImportIssue {
  code: string;
  message: string;
  blocking: boolean;
  row_ids: string[];
  ref?: string | null;
}

export interface HistoryImportRow {
  id: string;
  line_number: number;
  raw: Record<string, unknown>;
  edits?: Record<string, string> | null;
  values: Record<string, string>;
  excluded: boolean;
  match_decision?: MatchDecision | null;
  /** Split off the entry before it instead of being joined to it. */
  keep_separate: boolean;
  skipped_reason?: string | null;
  errors: string[];
  start?: string | null;
  end?: string | null;
  local_date?: string | null;
  minutes?: number | null;
  member_key?: string | null;
  unit_key?: string | null;
  position_key?: string | null;
  shift_key?: string | null;
  external_key?: string | null;
  attendance_key?: string | null;
}

export const MemberResolutionStatus = {
  MATCHED: 'matched',
  CONFLICT: 'conflict',
  AMBIGUOUS: 'ambiguous',
  UNMATCHED: 'unmatched',
  MAPPED: 'mapped',
  CREATE: 'create',
} as const;
export type MemberResolutionStatus = (typeof MemberResolutionStatus)[keyof typeof MemberResolutionStatus];

export interface HistoryImportMember {
  key: string;
  display_name: string;
  first_name: string;
  last_name: string;
  membership_number: string;
  email: string;
  username: string;
  status: MemberResolutionStatus;
  user_id?: string | null;
  candidate_ids: string[];
  reason: string;
  row_count: number;
  /** Settled by a decision remembered from an earlier import. */
  remembered: boolean;
}

export const UnitTargetKind = {
  OWN: 'own',
  EXTERNAL: 'external',
  NEW_EXTERNAL: 'new_external',
} as const;
export type UnitTargetKind = (typeof UnitTargetKind)[keyof typeof UnitTargetKind];

export interface HistoryImportUnit {
  key: string;
  unit: string;
  agency: string;
  /** matched | ambiguous | unmatched | mapped */
  status: string;
  target_kind?: UnitTargetKind | null;
  target_id?: string | null;
  candidates: { kind: string; id: string }[];
  new_agency_name: string;
  new_unit_name: string;
  row_count: number;
  /** Settled by a decision remembered from an earlier import. */
  remembered: boolean;
}

export interface HistoryImportPosition {
  key: string;
  source: string;
  /** matched | unmatched | mapped */
  status: string;
  seat?: string | null;
  row_count: number;
  /** Settled by a decision remembered from an earlier import. */
  remembered: boolean;
}

export interface HistoryImportAttendance {
  key: string;
  row_ids: string[];
  line_numbers: number[];
  /** A user id, or `new:<member key>` for a member the commit will create. */
  member_ref: string;
  unit_kind: UnitTargetKind;
  unit_ref: string;
  seat: string;
  role: string;
  start: string;
  end: string;
  local_date: string;
  minutes: number;
  call_count?: number | null;
  joined: boolean;
  confidence: number;
  needs_confirmation: boolean;
  duplicate_existing: boolean;
}

export const ExistingShiftStatus = {
  NONE: 'none',
  AUTO: 'auto',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  SEPARATED: 'separated',
} as const;
export type ExistingShiftStatus = (typeof ExistingShiftStatus)[keyof typeof ExistingShiftStatus];

export interface HistoryImportShift {
  key: string;
  apparatus_id: string;
  shift_date: string;
  start: string;
  end: string;
  existing_shift_id?: string | null;
  existing_confidence?: number | null;
  existing_status: ExistingShiftStatus;
  attendances: HistoryImportAttendance[];
}

export interface HistoryImportCounts {
  rows: number;
  excluded: number;
  skipped: number;
  with_errors: number;
  new_shifts: number;
  existing_shifts: number;
  attendances: number;
  external_entries: number;
  duplicates: number;
}

export interface HistoryImportOptionMember {
  id: string;
  name: string;
  membership_number: string;
  status: string;
}

export interface HistoryImportOptionUnit {
  kind: 'own' | 'external';
  id: string;
  name: string;
  agency_name?: string | null;
}

export interface HistoryImportOptions {
  members: HistoryImportOptionMember[];
  units: HistoryImportOptionUnit[];
  seats: string[];
}

export interface HistoryImportAnalysis {
  can_commit: boolean;
  blocking_issue_count: number;
  counts: HistoryImportCounts;
  rows: HistoryImportRow[];
  members: HistoryImportMember[];
  units: HistoryImportUnit[];
  positions: HistoryImportPosition[];
  shifts: HistoryImportShift[];
  external: HistoryImportAttendance[];
  issues: HistoryImportIssue[];
  options: HistoryImportOptions;
}

export interface HistoryImportDetail {
  import: HistoryImportSummary;
  headers: string[];
  column_mapping: Record<string, string>;
  fields: string[];
  member_mappings: Record<string, unknown>;
  unit_mappings: Record<string, unknown>;
  position_mappings: Record<string, unknown>;
  existing_shift_decisions: Record<string, unknown>;
  /** Null once committed: re-analysing would match the shifts it created. */
  analysis?: HistoryImportAnalysis | null;
}

export type MatchDecision = 'accept' | 'separate';

export type MemberMapping = { action: 'map'; user_id: string } | { action: 'create' };

export type UnitMapping =
  { action: 'own' | 'external'; id: string } | { action: 'create_external'; agency_name: string; unit_name: string };

export interface PositionMapping {
  seat: string;
}

export interface HistoryImportMappingsUpdate {
  members?: Record<string, MemberMapping | null>;
  units?: Record<string, UnitMapping | null>;
  positions?: Record<string, PositionMapping | null>;
  existing_shifts?: Record<string, MatchDecision | null>;
}

export interface HistoryImportRowUpdate {
  /** A null value drops the edit, reverting the field to the file's cell. */
  edits?: Record<string, string | null>;
  excluded?: boolean;
  /** null clears an earlier decision. */
  match_decision?: MatchDecision | null;
  /** Split this row off the entry before it (or rejoin it). */
  keep_separate?: boolean;
}

export interface HistoryImportSettingsUpdate {
  timezone?: string;
  /** A null or empty header unmaps the field. */
  column_mapping?: Record<string, string | null>;
}

/** Human labels for the import's field names, in the order the backend lists them. */
export const HISTORY_IMPORT_FIELD_LABELS: Record<string, string> = {
  member_name: 'Member name',
  first_name: 'First name',
  last_name: 'Last name',
  membership_number: 'Membership / department ID',
  email: 'Email',
  username: 'Username',
  unit: 'Unit',
  agency: 'Agency',
  position: 'Position',
  date: 'Date',
  start_time: 'Start time',
  end_time: 'End time',
  call_count: 'Calls',
  status: 'Status',
};
