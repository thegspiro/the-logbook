import type { InventoryItem } from '../types';
import { sizeLabel, standardSizeCode } from '../types';

/**
 * Returns the base display name for an inventory item, stripping the
 * ` — size [— color] [— style]` suffix that variant generation appends.
 *
 * Only strips for items that belong to a variant group (have variant_group_id)
 * to avoid accidentally truncating names that contain " — " for other reasons.
 */
export function getDisplayName(item: InventoryItem): string {
  if (!item.variant_group_id) return item.name;
  const idx = item.name.indexOf(' — ');
  if (idx > 0) return item.name.slice(0, idx);
  return item.name;
}

/**
 * The item's size as a person reads it, or '' when it has none.
 *
 * A value from the size vocabulary gets its picker label, because upper-casing
 * the stored code reads ONE_SIZE and XXXL where every picker in the app says
 * One Size and 3XL. Free text ("lg", "10.5 EE") has no label to look up and
 * keeps the upper-casing the capsule has always applied.
 *
 * Shared rather than inlined at each site: this is the one definition of how a
 * size is spelled, and the items list now renders it in two places (its own
 * column when grouped, the variant capsule otherwise). A second local copy is
 * exactly how `styleAttributesLabel` came to render "Mens" and "V Neck"
 * (CLAUDE.md pitfall #29).
 */
export function displaySize(item: Pick<InventoryItem, 'standard_size' | 'size'>): string {
  const raw = item.standard_size || item.size;
  return standardSizeCode(raw) ? sizeLabel(raw) : (raw ?? '').toUpperCase();
}
