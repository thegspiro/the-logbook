/**
 * One catalog search for the checklist builder, across gear and medical stock.
 *
 * The two live behind different endpoints on purpose — `/inventory/items`
 * excludes medical types, and `/medical-supplies/items` is pinned to them — so
 * a builder that searched only the first could never link a rig's gauze to the
 * row the EMS officer manages. It typed the name as free text instead, or
 * created a second, uncategorized row that landed on the gear page.
 *
 * Each half runs only when the viewer can read it, so a medical-only supply
 * officer is not handed a 403 on every keystroke. A half that fails marks the
 * result `incomplete`: callers still show what came back, but must not offer
 * to create — absence is only proven by a search that covered everything.
 */

import { inventoryService } from '@/services/inventoryService';
import { medicalSuppliesService } from '@/services/medicalSuppliesService';
import type { InventoryItem } from '@/services/eventServices';

export type CatalogDomain = 'medical' | 'gear';

export interface CatalogSearchHit {
  item: InventoryItem;
  domain: CatalogDomain;
}

export interface CatalogSearchScope {
  gear: boolean;
  medical: boolean;
}

export interface CatalogSearchResult {
  hits: CatalogSearchHit[];
  /** True when a half the viewer could read failed to answer. */
  incomplete: boolean;
}

export async function searchChecklistCatalog(
  query: string,
  scope: CatalogSearchScope,
  limit: number
): Promise<CatalogSearchResult> {
  // `fuzzy`: the name on the rig and the name in the catalog are rarely spelled
  // alike ("4 x 4 gauze", "BVM"), and a missed match here is how a second,
  // duplicate catalog row gets created. Exact matches still come first.
  const params = { search: query, limit, active_only: true, fuzzy: true };
  const [medical, gear] = await Promise.allSettled([
    scope.medical ? medicalSuppliesService.getItems(params) : Promise.resolve(null),
    scope.gear ? inventoryService.getItems(params) : Promise.resolve(null),
  ]);

  const hits: CatalogSearchHit[] = [];
  const seen = new Set<string>();
  const add = (items: InventoryItem[], domain: CatalogDomain) => {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      hits.push({ item, domain });
    }
  };
  // Medical first: checklist stock is overwhelmingly consumables, and the
  // medical row is the one whose lots and reorder point the supply officer
  // keeps current.
  if (medical.status === 'fulfilled' && medical.value) add(medical.value.items, 'medical');
  if (gear.status === 'fulfilled' && gear.value) add(gear.value.items, 'gear');

  return {
    hits: hits.slice(0, limit),
    incomplete: medical.status === 'rejected' || gear.status === 'rejected',
  };
}

/** Read an item's dated lots through the endpoint its domain is served on. */
export async function getCatalogItemLots(itemId: string, domain: CatalogDomain) {
  return domain === 'medical' ? medicalSuppliesService.getItemLots(itemId) : inventoryService.getItemLots(itemId);
}
