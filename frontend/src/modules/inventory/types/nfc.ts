/**
 * NFC tags attached to inventory items, storage areas and equipment-check
 * compartments, put-away, and the
 * staff tap log. Mirrors
 * `backend/app/schemas/inventory_nfc.py`; snake_case like the rest of the
 * inventory API.
 */

import type {
  InventoryAuditFrequency,
  InventoryNfcAuditResult,
  InventoryNfcScanAction,
  InventoryNfcTagStatus,
  NfcCredentialType,
} from '../../../constants/enums';
import type { InventoryItem } from './index';

export interface InventoryNfcTag {
  id: string;
  /** Exactly one of `item_id` / `storage_area_id` / `check_compartment_id` is set. */
  item_id: string | null;
  storage_area_id: string | null;
  check_compartment_id: string | null;
  /** Last four characters of the identifier; the identifier itself is never returned. */
  uid_preview: string;
  credential_type: NfcCredentialType;
  label: string | null;
  status: InventoryNfcTagStatus;
  linked_by: string | null;
  linked_by_name: string | null;
  linked_at: string;
}

export interface InventoryNfcTagListResponse {
  items: InventoryNfcTag[];
  total: number;
}

export interface InventoryNfcTagCreate {
  tag_uid: string;
  credential_type: NfcCredentialType;
  label?: string | undefined;
}

/** Update payload: `null` clears the label (CLAUDE.md pitfall #1, update half). */
export interface InventoryNfcTagUpdate {
  label?: string | null;
  status?: InventoryNfcTagStatus;
}

/** What a phone read off a tag; the written code is tried before the serial. */
export interface InventoryNfcResolveRequest {
  code?: string | undefined;
  serial_number?: string | undefined;
}

export interface InventoryNfcSettings {
  enabled: boolean;
}

/** What a tag is linked to. */
export type InventoryNfcTagTargetKind = 'item' | 'storage_area' | 'check_compartment';

export interface InventoryNfcResolveAnyRequest extends InventoryNfcResolveRequest {
  /** False from the put-away screen, whose move is logged on its own. */
  record?: boolean;
}

export interface InventoryNfcStorageAreaSummary {
  id: string;
  name: string;
  label: string | null;
  location_id: string | null;
}

/** Exactly one of `item` / `storage_area` is set, per `kind`. */
export interface InventoryNfcResolveAnyResponse {
  /** Never `check_compartment`: those resolve only during a check. */
  kind: 'item' | 'storage_area';
  tag_id: string;
  tag_uid_preview: string;
  item: InventoryItem | null;
  storage_area: InventoryNfcStorageAreaSummary | null;
}

/** A tap made during an equipment check of `template_id`. */
export interface InventoryNfcResolveCheckRequest extends InventoryNfcResolveRequest {
  template_id: string;
}

/**
 * `compartment`: jump to `compartment_id`. `item`: the checklist entries in
 * `template_item_ids` are linked to the tapped item, in checklist order.
 */
export interface InventoryNfcResolveCheckResponse {
  kind: 'compartment' | 'item';
  tag_id: string;
  compartment_id: string | null;
  compartment_name: string | null;
  item_name: string | null;
  template_item_ids: string[];
}

export interface InventoryNfcPutAwayRequest {
  item_id: string;
  storage_area_id: string;
  item_tag_id?: string | undefined;
}

export interface InventoryNfcPutAwayResponse {
  item_id: string;
  item_name: string;
  storage_area_id: string;
  storage_area_name: string;
  from_storage_area_id: string | null;
  from_storage_area_name: string | null;
  /** False when the item was already there; the tap is still logged. */
  moved: boolean;
}

export interface InventoryNfcScan {
  id: string;
  item_id: string;
  action: InventoryNfcScanAction;
  tag_uid_preview: string | null;
  storage_area_id: string | null;
  storage_area_name: string | null;
  from_storage_area_id: string | null;
  from_storage_area_name: string | null;
  scanned_by: string | null;
  scanned_by_name: string | null;
  scanned_at: string;
}

export interface InventoryNfcScanListResponse {
  items: InventoryNfcScan[];
  total: number;
}

// ---------------------------------------------------------------------------
// Shelf audits
// ---------------------------------------------------------------------------

/** Mirrors `MAX_AUDIT_TAPS` in the backend schema. */
export const MAX_AUDIT_TAPS = 500;

export interface InventoryNfcAuditTap {
  item_id: string;
  tag_id?: string | undefined;
}

export interface InventoryNfcAuditCreate {
  storage_area_id: string;
  tapped: InventoryNfcAuditTap[];
}

export interface InventoryNfcAuditLine {
  id: string;
  /** Null once the item has been deleted; the name is a snapshot. */
  item_id: string | null;
  item_name: string;
  result: InventoryNfcAuditResult;
  /** Where the system had the item when the audit ran. */
  recorded_storage_area_id: string | null;
  recorded_storage_area_name: string | null;
  moved: boolean;
}

export interface InventoryNfcAuditSummary {
  id: string;
  /** Null once the shelf has been deleted; the name is a snapshot. */
  storage_area_id: string | null;
  storage_area_name: string;
  expected_count: number;
  found_count: number;
  missing_count: number;
  unexpected_count: number;
  audited_by: string | null;
  audited_by_name: string | null;
  audited_at: string;
  applied_by: string | null;
  applied_by_name: string | null;
  applied_at: string | null;
}

export interface InventoryNfcAuditSkipped {
  item_id: string;
  name: string;
  reason: string;
}

export interface InventoryNfcAuditDetail extends InventoryNfcAuditSummary {
  items: InventoryNfcAuditLine[];
  /** Set only on the response to an apply. */
  moved_item_ids?: string[] | null;
  skipped?: InventoryNfcAuditSkipped[] | null;
}

export interface InventoryNfcAuditListResponse {
  items: InventoryNfcAuditSummary[];
  total: number;
}

// ---------------------------------------------------------------------------
// Member ID card lookup
// ---------------------------------------------------------------------------

export interface InventoryNfcMember {
  user_id: string;
  member_name: string;
  membership_number: string | null;
}

// ---------------------------------------------------------------------------
// Bulk enrollment
// ---------------------------------------------------------------------------

export interface InventoryNfcUntaggedItem {
  id: string;
  name: string;
  serial_number: string | null;
  asset_tag: string | null;
  category_name: string | null;
  storage_area_name: string | null;
}

export interface InventoryNfcUntaggedListResponse {
  items: InventoryNfcUntaggedItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Not-seen report (not NFC-gated; lives here beside the tap log it reads)
// ---------------------------------------------------------------------------

export type LastSeenSource =
  'nfc_tap' | 'assignment' | 'return' | 'checkout' | 'check_in' | 'issuance' | 'issuance_return';

export interface NotSeenItem {
  id: string;
  name: string;
  serial_number: string | null;
  asset_tag: string | null;
  category_name: string | null;
  /** An item status value; labels via `getStatusLabel`. */
  status: string;
  storage_area_name: string | null;
  /** All three are null for an item with no recorded event at all. */
  last_seen_at: string | null;
  last_seen_source: LastSeenSource | null;
  days_since_seen: number | null;
}

export interface NotSeenReport {
  items: NotSeenItem[];
  /** Every match, even when `items` was cut to the requested limit. */
  total: number;
  cutoff: string;
}

export interface NotSeenFilters {
  days?: number | undefined;
  category_id?: string | undefined;
  limit?: number | undefined;
}

// ---------------------------------------------------------------------------
// Audit schedule
// ---------------------------------------------------------------------------

export interface InventoryAuditScheduleRow {
  storage_area_id: string;
  storage_area_name: string;
  location_name: string | null;
  audit_frequency: InventoryAuditFrequency | null;
  last_audited_at: string | null;
  /** Null while the area has never been audited: it is due now. */
  next_due_at: string | null;
  overdue: boolean;
  days_overdue: number | null;
}

export interface InventoryAuditScheduleListResponse {
  items: InventoryAuditScheduleRow[];
  total: number;
}

// ---------------------------------------------------------------------------
// Self-service kiosk
// ---------------------------------------------------------------------------

export interface KioskLoan {
  checkout_id: string;
  item_id: string;
  item_name: string;
  checked_out_at: string;
  due_at: string | null;
}

export interface KioskIdentifyResponse {
  member_name: string;
  loans: KioskLoan[];
}

export type KioskAction = 'checkout' | 'return';

export interface KioskPreviewResponse {
  action: KioskAction;
  item_id: string;
  item_name: string;
  /** Checkout: when it will be due back. Return: when it was due. */
  due_at: string | null;
}

export interface KioskActionResponse {
  action: KioskAction;
  checkout_id: string;
  item_id: string;
  item_name: string;
  member_name: string;
  due_at: string | null;
  damaged: boolean;
}

/** What was read off the member's card and, for an item action, the tag. */
export interface KioskItemRequest {
  card: InventoryNfcResolveRequest;
  item: InventoryNfcResolveRequest;
}

export interface KioskReturnRequest extends KioskItemRequest {
  damaged: boolean;
  damage_notes?: string | undefined;
}
