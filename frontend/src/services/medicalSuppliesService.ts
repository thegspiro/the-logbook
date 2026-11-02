/**
 * medicalSuppliesService — the EMS side of the department's stock.
 *
 * Talks to /medical-supplies, which is pinned to the medical domain
 * server-side. Nothing here passes an item type: the domain is not the
 * client's to choose, so a request cannot widen its own scope into gear.
 *
 * Not listed in UNCACHEABLE_PREFIXES: this is department stock — item names,
 * lot numbers, quantities — and carries no member data. The similarly-named
 * /medical-screening/ endpoints do carry PHI and remain excluded.
 */

import api from './apiClient';
import { expectArray } from '../utils/asArray';
import type {
  ExpiringLot,
  InventoryCategory,
  InventoryCategoryCreate,
  InventoryImportResult,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemsListResponse,
  InventoryLot,
  InventoryLotBulkEntry,
  InventoryLotCreate,
  InventoryLotUpdate,
} from './eventServices';

/**
 * Options for the read paths this page refreshes on demand.
 *
 * `bypassCache` maps to the shared client's `_skipCache` request flag. The
 * client serves a cached GET for 30s without contacting the server, and serves
 * a stale one for 90s while revalidating in the background and swallowing that
 * revalidation's failures -- correct for navigation, wrong for a refresh the
 * user asked for, which would otherwise report success against old quantities
 * and never raise the failure the page is meant to surface.
 */
export interface MedicalReadOptions {
  bypassCache?: boolean;
  /**
   * Cancels the request. One options object rather than a separate positional
   * argument: both answer "how should this read be performed", and a caller
   * that refreshes past the cache usually also wants to be able to abandon it.
   */
  signal?: AbortSignal;
}

const readConfig = (options?: MedicalReadOptions) => ({
  ...(options?.bypassCache ? { _skipCache: true } : {}),
  ...(options?.signal ? { signal: options.signal } : {}),
});

export interface MedicalSupplySummary {
  total_items: number;
  expiring_soon: number;
  expired: number;
  low_stock: number;
  expiring_within_days: number;
  /**
   * Truck stock in the same window, counted apart from `expiring_soon` /
   * `expired` (which are shelf lots). The page shows the sum, and the split.
   */
  expiring_soon_on_apparatus?: number;
  expired_on_apparatus?: number;
  /** Supplies carried on a truck position nobody has counted, so counted at its target. */
  uncounted_on_apparatus?: number;
}

/**
 * A medical supply expiring soon, on a shelf or aboard an apparatus. `where`
 * is the storage path for a shelf lot and the checklist's naming ("Medic 1 ›
 * Main Compartment › Jump Bag") for truck stock.
 */
export interface MedicalExpiringStockRow {
  key: string;
  location: 'shelf' | 'apparatus';
  inventory_item_id: string;
  item_name?: string | null;
  item_size?: string | null;
  lot_id?: string | null;
  template_item_id?: string | null;
  /** The apparatus the units are aboard, when the checklist names one. */
  apparatus_id?: string | null;
  lot_number?: string | null;
  expiration_date?: string | null;
  days_until_expiration?: number | null;
  quantity: number;
  where?: string | null;
  /** Under an active recall of its lot number: pull it, whatever its date. */
  recalled?: boolean;
}

/** A manufacturer's recall of one lot number of one supply. */
export interface MedicalLotRecall {
  id: string;
  inventory_item_id: string;
  item_name?: string | null;
  item_size?: string | null;
  lot_number: string;
  reason?: string | null;
  recalled_at?: string | null;
  lifted_at?: string | null;
  lift_note?: string | null;
  /** Units still carrying the number, in the stock room and aboard trucks. */
  units_on_shelf: number;
  units_aboard: number;
}

export interface MedicalLotRecallCreate {
  inventory_item_id: string;
  lot_number: string;
  reason?: string | undefined;
}

/**
 * Update payload for a medical supply.
 *
 * Nullable rather than optional on purpose: the backend dumps updates with
 * `exclude_unset`, so an omitted key means "leave this alone". A field the
 * user cleared has to arrive as an explicit `null` or the old value survives
 * the save. See utils/formValues.
 */
export interface MedicalItemUpdate {
  name?: string;
  category_id?: string;
  size?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  also_called?: string[] | null;
  quantity?: number | null;
  unit_of_measure?: string | null;
  reorder_point?: number | null;
  apparatus_only?: boolean;
  /** Free text kept beside the structured location, shown as a note. */
  storage_location?: string | null;
  /** The room, and the storage area within it (Inventory › Storage Areas). */
  location_id?: string | null;
  storage_area_id?: string | null;
  vendor?: string | null;
}

/** A room or place a supply can be filed under. */
export interface MedicalStorageRoom {
  id: string;
  name: string;
}

/** An active storage area, with its room resolved from the top of its tree. */
export interface MedicalStorageArea {
  id: string;
  name: string;
  label?: string | null;
  storage_type?: string | null;
  parent_id?: string | null;
  location_id?: string | null;
  location_name?: string | null;
  /** "Cabinet B › Shelf 2", the area's own name last. */
  path: string;
}

export interface MedicalStorageOptions {
  rooms: MedicalStorageRoom[];
  areas: MedicalStorageArea[];
}

/**
 * An apparatus checklist position this supply fills. camelCase: it is the
 * equipment-check `ItemDeployment` schema, read through the medical route.
 */
export interface MedicalSupplyPlacement {
  templateItemId: string;
  itemName: string;
  compartmentName?: string | null;
  /** The checklist's nesting, outermost first: ["Main Compartment", "Jump Bag"]. */
  compartmentPath?: string[];
  templateId?: string | null;
  templateName?: string | null;
  apparatusId?: string | null;
  apparatusName?: string | null;
  apparatusType?: string | null;
  lotNumber?: string | null;
  expirationDate?: string | null;
  daysUntilExpiration?: number | null;
  isExpired: boolean;
  /** What the position should hold. */
  targetQuantity?: number | null;
  /** Last counted aboard; null when nobody has counted since it was set up. */
  quantityOnTruck?: number | null;
}

/** Same rationale as MedicalItemUpdate: a cleared field must send null. */
export interface MedicalCategoryUpdate {
  name?: string;
  description?: string | null;
  low_stock_threshold?: number | null;
}

export interface MedicalCategoryDeleteResult {
  category_name: string;
  items_moved: number;
  moved_to_name: string | null;
}

/**
 * Every property carries an explicit `| undefined` because the workspace runs
 * `exactOptionalPropertyTypes`, under which `?:` alone rejects an assigned
 * `undefined` — and a filter object built from empty form fields is nothing
 * but assigned undefineds.
 */
export interface MedicalItemFilters {
  category_id?: string | undefined;
  status?: string | undefined;
  condition?: string | undefined;
  location_id?: string | undefined;
  storage_area_id?: string | undefined;
  search?: string | undefined;
  /** With `search`, also return supplies whose name or "also called" names merely resemble it, below the exact matches. */
  fuzzy?: boolean | undefined;
  /** Only supplies at or below their reorder point — the set the summary's Low stock figure counts. */
  low_stock?: boolean | undefined;
  /** Leave out supplies kept on the apparatus only — they have no shelf to receive a delivery into. */
  exclude_apparatus_only?: boolean | undefined;
  /** Only supplies carried on a truck position no crew has counted — the summary's `uncounted_on_apparatus`. */
  uncounted?: boolean | undefined;
  active_only?: boolean | undefined;
  sort_by?: string | undefined;
  sort_order?: 'asc' | 'desc' | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

/**
 * The general import's result, plus what only this import does. `imported`
 * counts supplies created; `lots_added` counts stock lots recorded, whether on
 * a supply the file created or on one already on file.
 */
export interface MedicalImportResult extends InventoryImportResult {
  lots_added: number;
  categories_created: string[];
}

export interface MedicalBulkRetireResult {
  retired: string[];
  failed: Array<{ item_id: string; error: string }>;
}

/** The list's filters, minus paging: an export is the whole filtered set. */
export type MedicalExportFilters = Omit<MedicalItemFilters, 'skip' | 'limit' | 'fuzzy'>;

export const medicalSuppliesService = {
  async getSummary(expiringWithinDays?: number, options?: MedicalReadOptions): Promise<MedicalSupplySummary> {
    const response = await api.get<MedicalSupplySummary>('/medical-supplies/summary', {
      params: expiringWithinDays ? { expiring_within_days: expiringWithinDays } : undefined,
      ...readConfig(options),
    });
    return response.data;
  },

  async getCategories(activeOnly = true, options?: MedicalReadOptions): Promise<InventoryCategory[]> {
    const response = await api.get<InventoryCategory[]>('/medical-supplies/categories', {
      params: { active_only: activeOnly },
      ...readConfig(options),
    });
    return response.data;
  },

  async createCategory(data: InventoryCategoryCreate): Promise<InventoryCategory> {
    const response = await api.post<InventoryCategory>('/medical-supplies/categories', data);
    return response.data;
  },

  async updateCategory(categoryId: string, data: MedicalCategoryUpdate): Promise<InventoryCategory> {
    const response = await api.patch<InventoryCategory>(`/medical-supplies/categories/${categoryId}`, data);
    return response.data;
  },

  /**
   * Permanently deletes a category. One that still holds supplies is refused
   * (409) unless `moveItemsTo` names the category to move them to — a deleted
   * category would otherwise leave them with none, which files them as gear.
   */
  async deleteCategory(categoryId: string, moveItemsTo?: string): Promise<MedicalCategoryDeleteResult> {
    const response = await api.delete<MedicalCategoryDeleteResult>(`/medical-supplies/categories/${categoryId}`, {
      params: moveItemsTo ? { move_items_to: moveItemsTo } : undefined,
    });
    return response.data;
  },

  async getItems(filters?: MedicalItemFilters, options?: MedicalReadOptions): Promise<InventoryItemsListResponse> {
    const response = await api.get<InventoryItemsListResponse>('/medical-supplies/items', {
      params: filters,
      ...readConfig(options),
    });
    return response.data;
  },

  async getItem(itemId: string): Promise<InventoryItem> {
    const response = await api.get<InventoryItem>(`/medical-supplies/items/${itemId}`);
    return response.data;
  },

  async createItem(data: InventoryItemCreate): Promise<InventoryItem> {
    const response = await api.post<InventoryItem>('/medical-supplies/items', data);
    return response.data;
  },

  /**
   * Create a medical supply, or get back the one already carrying the name.
   *
   * The equipment check builder's create-and-link path. `category_id` must be
   * a medical category — that is what files the row on the Medical Supplies
   * page rather than as gear. A name already filed as gear is refused with 409
   * rather than linked; `created` says whether this call made the row.
   */
  async createItemIfAbsent(data: InventoryItemCreate): Promise<{ item: InventoryItem; created: boolean }> {
    const response = await api.post<{ item: InventoryItem; created: boolean }>(
      '/medical-supplies/items/create-if-absent',
      data
    );
    return response.data;
  },

  async updateItem(itemId: string, data: MedicalItemUpdate): Promise<InventoryItem> {
    const response = await api.patch<InventoryItem>(`/medical-supplies/items/${itemId}`, data);
    return response.data;
  },

  async retireItem(itemId: string, notes?: string): Promise<void> {
    await api.post(`/medical-supplies/items/${itemId}/retire`, { notes });
  },

  /**
   * Retire several supplies at once. Each is retired on its own, so ones that
   * cannot go (checked out, assigned) come back in `failed` while the rest
   * are retired.
   */
  async bulkRetireItems(itemIds: string[], notes?: string): Promise<MedicalBulkRetireResult> {
    const response = await api.post<MedicalBulkRetireResult>('/medical-supplies/items/bulk-retire', {
      item_ids: itemIds,
      ...(notes ? { notes } : {}),
    });
    return response.data;
  },

  /** Rooms and active storage areas a supply can be filed under. */
  async getStorageOptions(): Promise<MedicalStorageOptions> {
    const response = await api.get<MedicalStorageOptions>('/medical-supplies/storage-options');
    // Rejected rather than emptied: an empty room list reads as "this
    // department has no storage rooms", and the item form already says when
    // the storage areas could not be loaded. A body missing either list used
    // to reach the form's render and take the dialog down instead.
    return {
      rooms: expectArray(response.data.rooms, 'storage rooms'),
      areas: expectArray(response.data.areas, 'storage areas'),
    };
  },

  /** The apparatus checklist positions that carry this supply. */
  async getItemPlacements(itemId: string): Promise<MedicalSupplyPlacement[]> {
    const response = await api.get<MedicalSupplyPlacement[]>(`/medical-supplies/items/${itemId}/placements`);
    return response.data;
  },

  async getItemLots(itemId: string): Promise<InventoryLot[]> {
    const response = await api.get<InventoryLot[]>(`/medical-supplies/items/${itemId}/lots`);
    return response.data;
  },

  async addItemLot(itemId: string, data: InventoryLotCreate): Promise<InventoryLot> {
    const response = await api.post<InventoryLot>(`/medical-supplies/items/${itemId}/lots`, data);
    return response.data;
  },

  /** Record a whole delivery at once — one dated lot per item line. */
  async receiveDelivery(entries: InventoryLotBulkEntry[]): Promise<InventoryLot[]> {
    const response = await api.post<InventoryLot[]>('/medical-supplies/lots/bulk', { entries });
    return response.data;
  },

  async updateLot(lotId: string, data: InventoryLotUpdate): Promise<InventoryLot> {
    const response = await api.patch<InventoryLot>(`/medical-supplies/lots/${lotId}`, data);
    return response.data;
  },

  async deleteLot(lotId: string): Promise<void> {
    await api.delete(`/medical-supplies/lots/${lotId}`);
  },

  // Exports skip the response cache: a file somebody reconciles stock against
  // must be what the server holds now, not what it held thirty seconds ago.
  async exportItemsCsv(filters?: MedicalExportFilters): Promise<Blob> {
    const response = await api.get<Blob>('/medical-supplies/items/export', {
      params: filters,
      responseType: 'blob',
      ...readConfig({ bypassCache: true }),
    });
    return response.data;
  },

  async exportLotsCsv(): Promise<Blob> {
    const response = await api.get<Blob>('/medical-supplies/lots/export', {
      responseType: 'blob',
      ...readConfig({ bypassCache: true }),
    });
    return response.data;
  },

  async downloadImportTemplate(): Promise<Blob> {
    const response = await api.get<Blob>('/medical-supplies/items/import-template', { responseType: 'blob' });
    return response.data;
  },

  /**
   * A row creates a new supply, or — when it carries lot columns and names a
   * supply already on file — adds a stock lot to that supply. An unknown
   * category is created as a medical one.
   */
  async importItemsCsv(file: File): Promise<MedicalImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<MedicalImportResult>('/medical-supplies/items/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /** Expiring stock on the shelves and aboard the apparatus, soonest first. */
  async getExpiringStock(daysAhead = 30, options?: MedicalReadOptions): Promise<MedicalExpiringStockRow[]> {
    const response = await api.get<MedicalExpiringStockRow[]>('/medical-supplies/expiring-stock', {
      params: { days_ahead: daysAhead },
      ...readConfig(options),
    });
    return response.data;
  },

  /**
   * Every unit of a lot, on the shelves and the apparatus: the recall lookup.
   * A substring of the lot number, case-insensitive; at least 2 characters.
   * Read past the cache: after a recall the officer pulls units and searches
   * again, and a 30-second-old answer would still list the ones just pulled.
   */
  async getRecalls(includeLifted = false, options?: MedicalReadOptions): Promise<MedicalLotRecall[]> {
    const response = await api.get<MedicalLotRecall[]>('/medical-supplies/recalls', {
      params: { include_lifted: includeLifted },
      ...readConfig(options),
    });
    return response.data;
  },

  async recordRecall(data: MedicalLotRecallCreate): Promise<MedicalLotRecall> {
    const response = await api.post<MedicalLotRecall>('/medical-supplies/recalls', data);
    return response.data;
  },

  async liftRecall(recallId: string, note: string): Promise<MedicalLotRecall> {
    const response = await api.post<MedicalLotRecall>(
      `/medical-supplies/recalls/${encodeURIComponent(recallId)}/lift`,
      { note }
    );
    return response.data;
  },

  async searchLots(lotNumber: string): Promise<MedicalExpiringStockRow[]> {
    const response = await api.get<MedicalExpiringStockRow[]>('/medical-supplies/lots/search', {
      params: { lot_number: lotNumber },
      ...readConfig({ bypassCache: true }),
    });
    return response.data;
  },

  async getExpiringLots(daysAhead = 30, options?: MedicalReadOptions): Promise<ExpiringLot[]> {
    const response = await api.get<ExpiringLot[]>('/medical-supplies/lots/expiring', {
      params: { days_ahead: daysAhead },
      ...readConfig(options),
    });
    return response.data;
  },
};
