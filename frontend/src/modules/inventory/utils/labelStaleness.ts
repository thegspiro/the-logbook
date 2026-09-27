/**
 * Whether an edit left an item's printed label out of step with its record.
 *
 * Only an item that had a label confirmed printed can have one go stale. The
 * backend decides whether the encoded code changed: it clears
 * `label_printed_at` when the printable value moves, and this reads that
 * decision rather than re-deriving which identifier the label encodes. Text
 * the label shows beside the code — name, asset tag, serial number — does not
 * affect scanning, so the mark survives it, but the label now reads wrong.
 */

import type { InventoryItem } from '../types';

export interface LabelChange {
  /** 'code': the old label no longer scans to this item. 'text': it scans, but reads out of date. */
  kind: 'code' | 'text';
  /** The printed fields that changed, for the message. */
  fields: string[];
}

const PRINTED_TEXT_FIELDS: Array<{ key: 'name' | 'asset_tag' | 'serial_number'; label: string }> = [
  { key: 'name', label: 'name' },
  { key: 'asset_tag', label: 'asset tag' },
  { key: 'serial_number', label: 'serial number' },
];

export function labelChangeAfterEdit(before: InventoryItem, after: InventoryItem): LabelChange | null {
  if (!before.label_printed_at) return null;
  const fields = PRINTED_TEXT_FIELDS.filter(({ key }) => (before[key] || '') !== (after[key] || '')).map(
    ({ label }) => label
  );
  if (!after.label_printed_at) return { kind: 'code', fields };
  return fields.length > 0 ? { kind: 'text', fields } : null;
}
