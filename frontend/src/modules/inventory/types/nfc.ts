/**
 * NFC tags attached to inventory items and storage areas, put-away, and the
 * staff tap log. Mirrors
 * `backend/app/schemas/inventory_nfc.py`; snake_case like the rest of the
 * inventory API.
 */

import type { InventoryNfcScanAction, InventoryNfcTagStatus, NfcCredentialType } from '../../../constants/enums';
import type { InventoryItem } from './index';

export interface InventoryNfcTag {
  id: string;
  /** Exactly one of `item_id` / `storage_area_id` is set. */
  item_id: string | null;
  storage_area_id: string | null;
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
export type InventoryNfcTagTargetKind = 'item' | 'storage_area';

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
  kind: InventoryNfcTagTargetKind;
  tag_id: string;
  tag_uid_preview: string;
  item: InventoryItem | null;
  storage_area: InventoryNfcStorageAreaSummary | null;
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
