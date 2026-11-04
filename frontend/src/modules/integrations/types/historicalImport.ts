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
