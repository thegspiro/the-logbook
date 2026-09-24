/**
 * What an inventory label prints besides its code.
 *
 * The keys are sent as `extra_lines` to the label PDF and to a network
 * printer, and saved with the position's label preset. The backend builds the
 * printed text (`_build_extra_lines` and `build_label_specs` in
 * inventory_service.py); these helpers build the same text for the on-screen
 * preview, so a change to one side needs the other.
 */

import type { InventoryItem, StorageAreaResponse } from '../types';

/** Extra fields, printed on one line in the order chosen. */
export const LABEL_EXTRA_FIELDS = [
  { key: 'location', label: 'Location' },
  { key: 'storage_area', label: 'Storage area' },
  { key: 'category', label: 'Category' },
  { key: 'size', label: 'Size' },
  { key: 'condition', label: 'Condition' },
] as const;

// The asset tag and serial number print unless one of these is present.
export const HIDE_ASSET_TAG = 'no_asset_tag';
export const HIDE_SERIAL_NUMBER = 'no_serial_number';

const KNOWN_KEYS = new Set<string>([...LABEL_EXTRA_FIELDS.map((f) => f.key), HIDE_ASSET_TAG, HIDE_SERIAL_NUMBER]);

/** Keep only keys this page offers, dropping anything stale or malformed. */
export function sanitizeLabelLines(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const lines = raw.filter((key): key is string => typeof key === 'string' && KNOWN_KEYS.has(key));
  return Array.from(new Set(lines));
}

/** Names the extra line needs, which the item rows carry only as ids. */
export interface LabelNames {
  categories: Map<string, string>;
  locations: Map<string, string>;
  areaPaths: Map<string, string>;
}

export const EMPTY_LABEL_NAMES: LabelNames = {
  categories: new Map(),
  locations: new Map(),
  areaPaths: new Map(),
};

/** "Rack A > Shelf 2" for every area, as the backend's `storage_area_paths`. */
export function storageAreaPaths(areas: StorageAreaResponse[]): Map<string, string> {
  const byId = new Map(areas.map((a) => [a.id, a]));
  const paths = new Map<string, string>();
  for (const area of areas) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur: StorageAreaResponse | undefined = area;
    // Bounded by `seen`: a cycle in parent_id must not hang the page.
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    paths.set(area.id, parts.join(' > '));
  }
  return paths;
}

/** "Asset: AT-7 | S/N: 123", omitting a value the code already shows. */
export function labelIdentifierLine(item: InventoryItem, barcodeValue: string, lines: string[]): string | null {
  const parts: string[] = [];
  if (!lines.includes(HIDE_ASSET_TAG) && item.asset_tag && item.asset_tag !== barcodeValue) {
    parts.push(`Asset: ${item.asset_tag}`);
  }
  if (!lines.includes(HIDE_SERIAL_NUMBER) && item.serial_number && item.serial_number !== barcodeValue) {
    parts.push(`S/N: ${item.serial_number}`);
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}

/** The extra line, in the order the fields were chosen. */
export function labelExtraLine(item: InventoryItem, lines: string[], names: LabelNames): string | null {
  const parts: string[] = [];
  for (const key of lines) {
    if (key === 'location' && item.location_id) {
      parts.push(names.locations.get(item.location_id) ?? item.location_id);
    } else if (key === 'category' && item.category_id) {
      parts.push(names.categories.get(item.category_id) ?? item.category_id.slice(0, 8));
    } else if (key === 'condition' && item.condition) {
      parts.push(item.condition.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
    } else if (key === 'size' && item.size) {
      parts.push(item.size);
    } else if (key === 'storage_area' && item.storage_area_id) {
      const path = names.areaPaths.get(item.storage_area_id);
      if (path) parts.push(path);
    }
  }
  return parts.length > 0 ? parts.join(' | ') : null;
}
