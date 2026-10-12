/**
 * Departure clearance — the record of a leaving member's outstanding gear.
 *
 * `schemas/inventory.py` declares no alias generator, so these are snake_case,
 * as the wire is.
 */

export const CLEARANCE_DISPOSITIONS = ['returned', 'returned_damaged', 'written_off', 'waived'] as const;
export type ClearanceResolveDisposition = (typeof CLEARANCE_DISPOSITIONS)[number];
export type ClearanceDisposition = 'pending' | ClearanceResolveDisposition;

export type ClearanceStatus = 'initiated' | 'in_progress' | 'completed' | 'closed_incomplete';

export const CLEARANCE_DISPOSITION_LABELS: Record<ClearanceDisposition, string> = {
  pending: 'Outstanding',
  returned: 'Returned',
  returned_damaged: 'Returned damaged',
  written_off: 'Written off',
  waived: 'Waived',
};

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  initiated: 'Open',
  in_progress: 'In progress',
  completed: 'Completed',
  closed_incomplete: 'Closed incomplete',
};

export const CLEARANCE_SOURCE_LABELS: Record<ClearanceLineItem['source_type'], string> = {
  assignment: 'Assignment',
  checkout: 'Temporary loan',
  issuance: 'Issuance',
};

export interface ClearanceLineItem {
  id: string;
  clearance_id: string;
  source_type: 'assignment' | 'checkout' | 'issuance';
  source_id: string;
  item_id?: string | null;
  item_name: string;
  item_serial_number?: string | null;
  item_asset_tag?: string | null;
  item_value?: number | null;
  quantity: number;
  disposition: ClearanceDisposition;
  return_condition?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
  resolution_notes?: string | null;
  created_at: string;
}

export interface DepartureClearance {
  id: string;
  organization_id: string;
  user_id: string;
  member_name?: string | null;
  status: ClearanceStatus;
  total_items: number;
  items_cleared: number;
  items_outstanding: number;
  total_value: number;
  value_outstanding: number;
  initiated_at: string;
  completed_at?: string | null;
  return_deadline?: string | null;
  departure_type?: 'dropped_voluntary' | 'dropped_involuntary' | 'retired' | null;
  notes?: string | null;
  line_items: ClearanceLineItem[];
}

export interface ResolveClearanceItemPayload {
  disposition: ClearanceResolveDisposition;
  return_condition?: string | undefined;
  resolution_notes?: string | undefined;
}

export interface CompleteClearancePayload {
  force_close: boolean;
  notes?: string | undefined;
}
