/**
 * NFC tags attached to inventory items. Mirrors
 * `backend/app/schemas/inventory_nfc.py`; snake_case like the rest of the
 * inventory API.
 */

import type { InventoryNfcTagStatus, NfcCredentialType } from '../../../constants/enums';

export interface InventoryNfcTag {
  id: string;
  item_id: string;
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
