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
import type {
  ExpiringLot,
  InventoryCategory,
  InventoryCategoryCreate,
  InventoryItem,
  InventoryItemCreate,
  InventoryItemsListResponse,
  InventoryLot,
  InventoryLotBulkEntry,
  InventoryLotCreate,
  InventoryLotUpdate,
} from './eventServices';

export interface MedicalSupplySummary {
  total_items: number;
  expiring_soon: number;
  expired: number;
  low_stock: number;
  expiring_within_days: number;
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
  description?: string | null;
  manufacturer?: string | null;
  quantity?: number | null;
  unit_of_measure?: string | null;
  reorder_point?: number | null;
  storage_location?: string | null;
  vendor?: string | null;
}

/** Same rationale as MedicalItemUpdate: a cleared field must send null. */
export interface MedicalCategoryUpdate {
  name?: string;
  description?: string | null;
  low_stock_threshold?: number | null;
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
  active_only?: boolean | undefined;
  sort_by?: string | undefined;
  sort_order?: 'asc' | 'desc' | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

export const medicalSuppliesService = {
  async getSummary(expiringWithinDays?: number): Promise<MedicalSupplySummary> {
    const response = await api.get<MedicalSupplySummary>('/medical-supplies/summary', {
      params: expiringWithinDays ? { expiring_within_days: expiringWithinDays } : undefined,
    });
    return response.data;
  },

  async getCategories(activeOnly = true): Promise<InventoryCategory[]> {
    const response = await api.get<InventoryCategory[]>('/medical-supplies/categories', {
      params: { active_only: activeOnly },
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

  async getItems(filters?: MedicalItemFilters, signal?: AbortSignal): Promise<InventoryItemsListResponse> {
    const response = await api.get<InventoryItemsListResponse>('/medical-supplies/items', {
      params: filters,
      ...(signal ? { signal } : {}),
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

  async updateItem(itemId: string, data: MedicalItemUpdate): Promise<InventoryItem> {
    const response = await api.patch<InventoryItem>(`/medical-supplies/items/${itemId}`, data);
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

  async getExpiringLots(daysAhead = 30): Promise<ExpiringLot[]> {
    const response = await api.get<ExpiringLot[]>('/medical-supplies/lots/expiring', {
      params: { days_ahead: daysAhead },
    });
    return response.data;
  },
};
