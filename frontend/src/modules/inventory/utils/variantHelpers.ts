import type { InventoryItem } from '../types';

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
