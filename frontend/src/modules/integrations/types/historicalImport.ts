/**
 * Historical data import — wire types.
 *
 * snake_case, matching `backend/app/schemas/historical_import.py`, which (like
 * the shift history import whose batches it creates) carries no camelCase
 * alias generator.
 */

import type { HistoricalRecordType } from '../../../constants/enums';
import type { HistoryImportCommitSummary } from '../../scheduling/types/historyImport';

export const HistoricalImportStatus = {
  DRAFT: 'draft',
  ROUTED: 'routed',
} as const;
export type HistoricalImportStatus = (typeof HistoricalImportStatus)[keyof typeof HistoricalImportStatus];

export interface HistoricalImportSummary {
  id: string;
  status: HistoricalImportStatus;
  source_filename: string;
  source_system: string;
  timezone: string;
  row_count: number;
  created_by?: string | null;
  created_at?: string | null;
  routed_at?: string | null;
}

export interface RoutingTypeTotals {
  records: number;
  hours: number;
  first_date?: string | null;
  last_date?: string | null;
}

export interface RoutingNote {
  count: number;
  examples: { line_number: number; message: string }[];
}

export interface RoutingSummary {
  rows: number;
  skipped: number;
  with_errors: number;
  errors: { line_number: number; messages: string[] }[];
  /** Clean-up applied, by kind: `hours_differ`, `next_day`, `past_midnight`. */
  notes: Record<string, RoutingNote>;
  types: Record<string, RoutingTypeTotals>;
}

export interface ShiftBatch {
  id: string;
  /** `draft` while in review, `committed` once written. */
  status: string;
  source_filename: string;
  row_count: number;
  created_at?: string | null;
  committed_at?: string | null;
  summary?: Partial<HistoryImportCommitSummary> | null;
}

export interface CallTypeOption {
  slug: string;
  label: string;
}

export interface HistoricalImportDetail {
  import: HistoricalImportSummary;
  headers: string[];
  column_mapping: Record<string, string>;
  hour_columns: Record<string, HistoricalRecordType>;
  call_columns: Record<string, string>;
  fields: string[];
  record_types: HistoricalRecordType[];
  /** Record types this release sends on to an import. */
  importable_types: HistoricalRecordType[];
  call_types: CallTypeOption[];
  routing: RoutingSummary;
  /** Source rows this import's committed batches have written. */
  rows_imported: number;
  batches: ShiftBatch[];
  /** True while a shift batch is in review; settings cannot change then. */
  settings_locked: boolean;
}

export interface HistoricalImportSettingsUpdate {
  source_system?: string;
  timezone?: string;
  /** `{field: header}`; null unmaps. */
  column_mapping?: Record<string, string | null>;
  /** `{header: record type}`; null drops the column. */
  hour_columns?: Record<string, HistoricalRecordType | null>;
  /** `{header: call type slug}`; null drops the column. */
  call_columns?: Record<string, string | null>;
}

export const HISTORICAL_FIELD_LABELS: Record<string, string> = {
  membership_number: 'Membership / volunteer ID',
  member_name: 'Member name',
  first_name: 'First name',
  last_name: 'Last name',
  email: 'Email',
  date: 'Date',
  start_time: 'Start time',
  end_time: 'End time',
  source_id: 'Row ID (keeps a re-import from counting twice)',
  unit: 'Unit / apparatus',
  agency: 'Agency',
  position: 'Position',
};

export const HISTORICAL_RECORD_TYPE_LABELS: Record<string, string> = {
  shift: 'Shift hours (in station)',
  on_call: 'On-call hours (recall)',
  training: 'Training hours',
  admin: 'Administrative hours',
  ignore: 'Not used',
};

export const ROUTING_NOTE_LABELS: Record<string, string> = {
  hours_differ: 'Recorded hours used instead of the clock times',
  next_day: 'Ends the next day',
  past_midnight: 'Time written past 2400, read as the next day',
};

// ---------------------------------------------------------------------------
// Administrative hours
// ---------------------------------------------------------------------------

export interface FlagCategoryRule {
  column: string;
  category_id: string;
}

export interface AdminSettings {
  description_columns: string[];
  /** Applied in order; the first rule whose column is set wins. */
  flag_categories: FlagCategoryRule[];
  /** Administrative hours column -> the category its rows take otherwise. */
  default_categories: Record<string, string>;
}

export interface AdminMember {
  key: string;
  display_name: string;
  membership_number: string;
  /** unmatched | conflict | ambiguous | create */
  status: string;
  reason: string;
  candidate_ids: string[];
  new_first_name: string;
  new_last_name: string;
  row_count: number;
}

export interface AdminPreview {
  settings: AdminSettings;
  categories: { id: string; name: string; is_active: boolean }[];
  pending_records: number;
  already_imported: number;
  by_category: { category_id?: string | null; name: string; records: number; hours: number }[];
  uncategorized: number;
  flag_conflicts: number;
  problems: string[];
  problem_count: number;
  members: AdminMember[];
  member_options: { id: string; name: string; membership_number: string; status: string }[];
  can_commit: boolean;
  result?: { entries_created?: number; members_created?: number; committed_at?: string } | null;
}

export type AdminMemberMapping =
  | { action: 'map'; user_id: string }
  | { action: 'create'; first_name?: string | undefined; last_name?: string | undefined };

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export type UnmatchedProviderAction = 'import' | 'skip';

export interface TrainingSettings {
  subject_column: string;
  instructor_column: string;
  /** A yes/no column: set when the member taught the class. */
  taught_column: string;
  provider_patterns: string[];
  unmatched_provider_action?: UnmatchedProviderAction | null;
  /** Subject key -> course id; a subject with no entry is imported as written. */
  subject_courses: Record<string, string>;
  /** A yes/no column marking a department drill; absent from an older server. */
  drill_column?: string;
  drill_requirement_ids?: string[];
  drill_min_members?: number;
}

export interface TrainingSettingsUpdate {
  subject_column?: string;
  instructor_column?: string;
  taught_column?: string;
  provider_patterns?: string[];
  unmatched_provider_action?: UnmatchedProviderAction | null;
  /** Merged by key; null removes a subject's mapping. */
  subject_courses?: Record<string, string | null>;
  drill_column?: string;
  /** Replaces the set of attendance requirements the drills count toward. */
  drill_requirement_ids?: string[];
  drill_min_members?: number;
}

export interface TrainingSubject {
  key: string;
  subject: string;
  records: number;
  hours: number;
  course_id?: string | null;
  course_name: string;
  suggested_course_id?: string | null;
}

export interface TrainingPreview {
  settings: TrainingSettings;
  headers: string[];
  pending_records: number;
  already_imported: number;
  provider_rows: number;
  provider_matched: number;
  provider_unmatched: number;
  subject_count: number;
  subjects_mapped: number;
  records_mapped: number;
  subjects: TrainingSubject[];
  subject_total: number;
  courses: { id: string; name: string; training_type: string }[];
  problems: string[];
  problem_count: number;
  members: AdminMember[];
  member_options: { id: string; name: string; membership_number: string; status: string }[];
  can_commit: boolean;
  result?: {
    records_created?: number;
    provider_duplicates_skipped?: number;
    provider_unmatched_skipped?: number;
    members_created?: number;
  } | null;
}

export interface DrillDate {
  date: string;
  members: number;
  session_created: boolean;
}

export interface DrillRequirementOption {
  id: string;
  name: string;
  required_attendance_pct?: number | null;
}

export interface DrillResult {
  sessions_created?: number;
  sessions_relinked?: number;
  records_attached?: number;
  committed_at?: string;
}

/** The CompanyDrill rows by date: which dates become held drills. */
export interface DrillPreview {
  settings: TrainingSettings;
  headers: string[];
  drill_rows: number;
  drill_dates: number;
  qualifying_dates: number;
  qualifying_rows: number;
  sessions_created: number;
  /** One page of qualifying dates, newest first. */
  dates: DrillDate[];
  requirements: DrillRequirementOption[];
  /** The drills attach the records the training step wrote. */
  training_committed: boolean;
  can_commit: boolean;
  result?: DrillResult | null;
}
