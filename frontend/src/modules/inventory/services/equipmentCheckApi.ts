/**
 * Equipment Check API client.
 *
 * Equipment checklists belong to Inventory: a checklist position carries an
 * `inventoryItemId` into the catalog, and the lots aboard a truck are
 * snapshots of `inventory_lots` rows. The router is gated on the Inventory
 * module.
 *
 * The endpoints keep their `/equipment-checks` prefix: the API path did not
 * move, only ownership of the feature.
 *
 * Scheduling imports this module directly where it still needs it — the shift
 * detail panel and check-in page read a shift's checklists, and the template
 * form offers them. There is deliberately no re-export from
 * `modules/scheduling/services/api`: one import path means one place to look
 * when asking who still depends on checks from the shift side.
 */
import { createApiClient } from '../../../utils/createApiClient';
import { asArray } from '../../../utils/asArray';
import { blankToNull } from '@/utils/formValues';
import type {
  ApparatusInventory,
  CheckLogResponse,
  CheckTemplateCompartment,
  CheckTemplateCompartmentCreate,
  CheckTemplateCompartmentUpdate,
  CheckTemplateItem,
  CheckTemplateItemCreate,
  CheckTemplateItemUpdate,
  ComplianceReport,
  EquipmentCheckTemplate,
  EquipmentCheckTemplateCreate,
  EquipmentCheckTemplateUpdate,
  ExpiredStockDisposition,
  FailureLogResponse,
  FleetReadinessResponse,
  InventoryLinkResult,
  InventoryMatchesResult,
  ItemDeployedLots,
  ItemDeployment,
  ItemRestockState,
  ItemTrendResponse,
  LastCheckItemResult,
  LastSealRecord,
  LotSwapResult,
  ShiftCheckSummary,
  ShiftEquipmentCheckCreate,
  ShiftEquipmentCheckRecord,
  StandaloneEquipmentCheckCreate,
  SupplyOverview,
  TemplateChangeLogResponse,
} from '../types/equipmentCheck';
import { normalizeCheckType } from '../types/equipmentCheck';

export interface ActiveChecklistRecord {
  shiftId: string;
  shiftDate: string;
  apparatusName: string;
  templateId: string;
  templateName: string;
  checkTiming: string;
  status: string;
  totalItems?: number;
  completedItems?: number;
  checkId?: string;
}

// SEC: the shared axios factory, not a hand-rolled instance — it is what
// carries withCredentials, the CSRF double-submit header and the 401 refresh
// (CLAUDE.md pitfall #7). The refresh promise behind that refresh is shared
// globally, which is why a second instance is safe built this way and only
// this way.
const api = createApiClient();

/**
 * Settle every item's `checkType` to one of the four canonical values.
 *
 * The read boundary is where this belongs, and it is what `normalizeCheckType`
 * was written for -- its own doc comment says so -- but nothing called it: the
 * live check form compares `item.checkType` against 'count' / 'level' /
 * 'expiry' / 'function' directly, and its switch ends in
 * `default: passFailButtons`.
 *
 * So a response carrying the older spellings (`quantity`, `pass_fail`,
 * `reading`, `date_lot`) does not fail, it *degrades*: every count, level and
 * expiry item silently renders the pass/fail control. The crew answers Pass on
 * a row that was meant to record a number, no quantity is stored, and "Set all
 * to par" has nothing to act on. `pass_fail` is the cruel part -- it lands on
 * the right control by accident, so most of the form looks fine.
 *
 * That is not hypothetical. It is exactly what a backend running the previous
 * release serves, which is the normal state of a rolling deploy, and it was
 * found that way: a backend process left running across an upgrade rendered
 * every counted item on the medic's supply check as pass/fail.
 */
function normalizeTemplateCheckTypes<T extends EquipmentCheckTemplate>(template: T): T {
  if (!Array.isArray(template?.compartments)) return template;
  return {
    ...template,
    compartments: template.compartments.map((compartment) => ({
      ...compartment,
      items: Array.isArray(compartment.items)
        ? compartment.items.map((item) => ({ ...item, checkType: normalizeCheckType(item.checkType) }))
        : compartment.items,
    })),
  };
}

export const equipmentCheckService = {
  async createEquipmentCheckTemplate(data: EquipmentCheckTemplateCreate): Promise<EquipmentCheckTemplate> {
    const response = await api.post<EquipmentCheckTemplate>('/equipment-checks/templates', data);
    return response.data;
  },
  async getEquipmentCheckTemplates(params?: {
    apparatus_id?: string;
    apparatus_type?: string;
    check_timing?: string;
  }): Promise<EquipmentCheckTemplate[]> {
    const response = await api.get<EquipmentCheckTemplate[]>('/equipment-checks/templates', { params });
    return asArray(response.data).map(normalizeTemplateCheckTypes);
  },
  async getEquipmentCheckTemplate(templateId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.get<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`);
    return normalizeTemplateCheckTypes(response.data);
  },
  async updateEquipmentCheckTemplate(
    templateId: string,
    data: EquipmentCheckTemplateUpdate
  ): Promise<EquipmentCheckTemplate> {
    const response = await api.put<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}`, data);
    return response.data;
  },
  async deleteEquipmentCheckTemplate(templateId: string): Promise<void> {
    await api.delete(`/equipment-checks/templates/${templateId}`);
  },
  async cloneEquipmentCheckTemplate(templateId: string, targetApparatusId: string): Promise<EquipmentCheckTemplate> {
    const response = await api.post<EquipmentCheckTemplate>(`/equipment-checks/templates/${templateId}/clone`, null, {
      params: { target_apparatus_id: targetApparatusId },
    });
    return response.data;
  },

  // --- Supply Officer: expiring items + lot swap ---
  async getSupplyExpiringItems(daysAhead = 30): Promise<SupplyOverview> {
    const response = await api.get<SupplyOverview>('/equipment-checks/supply/expiring-items', {
      params: { days_ahead: daysAhead },
    });
    return response.data;
  },
  async getApparatusInventory(apparatusId: string): Promise<ApparatusInventory> {
    const response = await api.get<ApparatusInventory>(`/equipment-checks/apparatus/${apparatusId}/inventory`);
    return response.data;
  },
  async reportItemUsed(templateItemId: string, note?: string, quantityUsed?: number): Promise<ItemRestockState> {
    const response = await api.post<ItemRestockState>(`/equipment-checks/items/${templateItemId}/used`, {
      // Create payload: a blank note is omitted rather than sent as "".
      note: note?.trim() || undefined,
      quantity_used: quantityUsed || undefined,
    });
    return response.data;
  },
  async getItemDeployedLots(templateItemId: string): Promise<ItemDeployedLots> {
    const response = await api.get<ItemDeployedLots>(`/equipment-checks/items/${templateItemId}/deployed-lots`);
    return response.data;
  },
  /**
   * Correct one lot aboard — count, lot number and date together.
   *
   * Update payload: `lotNumber` / `expirationDate` are omitted when not being
   * changed and sent as an explicit null to clear, so a corrected box cannot
   * silently keep the old expiration.
   */
  async updateDeployedLot(
    templateItemId: string,
    deployedLotId: string,
    changes: { quantity: number; lotNumber?: string | null; expirationDate?: string | null }
  ): Promise<ItemDeployedLots> {
    const body: Record<string, unknown> = { quantity: changes.quantity };
    if (changes.lotNumber !== undefined) body.lot_number = blankToNull(changes.lotNumber);
    if (changes.expirationDate !== undefined) body.expiration_date = blankToNull(changes.expirationDate);
    const response = await api.put<ItemDeployedLots>(
      `/equipment-checks/items/${templateItemId}/deployed-lots/${deployedLotId}`,
      body
    );
    return response.data;
  },
  async setItemQuantity(templateItemId: string, quantity: number): Promise<ItemRestockState> {
    const response = await api.put<ItemRestockState>(`/equipment-checks/items/${templateItemId}/quantity`, {
      quantity,
    });
    return response.data;
  },
  async clearItemRestock(templateItemId: string): Promise<ItemRestockState> {
    const response = await api.delete<ItemRestockState>(`/equipment-checks/items/${templateItemId}/used`);
    return response.data;
  },
  async getItemDeployments(inventoryItemId: string): Promise<ItemDeployment[]> {
    const response = await api.get<ItemDeployment[]>(`/equipment-checks/supply/item-deployments/${inventoryItemId}`);
    return response.data;
  },
  /**
   * `replaced` marks the swap a replacement: the expired units come off the
   * truck and the disposition records where they went. Omitting it tops the
   * position up and retires nothing.
   *
   * `deployedLotId` narrows that to one lot, which is what a position carrying
   * several boxes needs. A position whose units were never lot-tracked has no
   * id to send — one blob, one date — so the disposition stands alone.
   */
  async swapItemLot(
    templateItemId: string,
    inventoryLotId: string,
    quantity = 1,
    replaced?: { disposition: ExpiredStockDisposition; deployedLotId?: string | undefined }
  ): Promise<LotSwapResult> {
    const response = await api.post<LotSwapResult>(`/equipment-checks/items/${templateItemId}/swap`, {
      inventory_lot_id: inventoryLotId,
      quantity,
      ...(replaced
        ? {
            disposition: replaced.disposition,
            ...(replaced.deployedLotId ? { replaced_deployed_lot_id: replaced.deployedLotId } : {}),
          }
        : {}),
    });
    return response.data;
  },

  // --- Compartment CRUD ---
  async addCompartment(templateId: string, data: CheckTemplateCompartmentCreate): Promise<CheckTemplateCompartment> {
    const response = await api.post<CheckTemplateCompartment>(
      `/equipment-checks/templates/${templateId}/compartments`,
      data
    );
    return response.data;
  },
  async updateCompartment(
    compartmentId: string,
    data: CheckTemplateCompartmentUpdate
  ): Promise<CheckTemplateCompartment> {
    const response = await api.put<CheckTemplateCompartment>(`/equipment-checks/compartments/${compartmentId}`, data);
    return response.data;
  },
  async deleteCompartment(compartmentId: string): Promise<void> {
    await api.delete(`/equipment-checks/compartments/${compartmentId}`);
  },
  /**
   * Swap a template's whole contents in one transaction.
   *
   * The builder's bulk-replacement paths clear the template and load a preset
   * or an import in its place. The discard travels with the replacement
   * because they are one decision: sent on its own it commits an empty
   * template, leaving the new contents in the browser until the next Save —
   * a closed tab in between costs the department the checklist it had.
   *
   * An empty list is a valid request: it clears the template.
   */
  async replaceCompartments(
    templateId: string,
    compartments: CheckTemplateCompartmentCreate[]
  ): Promise<CheckTemplateCompartment[]> {
    const response = await api.post<CheckTemplateCompartment[]>(
      `/equipment-checks/templates/${templateId}/compartments/replace`,
      { compartments }
    );
    return response.data;
  },
  async cloneCompartment(compartmentId: string, sortOrder: number): Promise<CheckTemplateCompartment> {
    const response = await api.post<CheckTemplateCompartment>(`/equipment-checks/compartments/${compartmentId}/clone`, {
      sort_order: sortOrder,
    });
    return response.data;
  },
  async reorderCompartments(templateId: string, orderedIds: string[]): Promise<void> {
    await api.put(`/equipment-checks/templates/${templateId}/compartments/reorder`, { ordered_ids: orderedIds });
  },

  // --- Item CRUD ---
  async addCheckItem(compartmentId: string, data: CheckTemplateItemCreate): Promise<CheckTemplateItem> {
    const response = await api.post<CheckTemplateItem>(`/equipment-checks/compartments/${compartmentId}/items`, data);
    return response.data;
  },
  async addCheckItemsBulk(compartmentId: string, items: CheckTemplateItemCreate[], idempotencyKey: string) {
    const response = await api.post<import('../types/equipmentCheck').CheckTemplateItemBulkResult>(
      `/equipment-checks/compartments/${compartmentId}/items/bulk`,
      { items, idempotency_key: idempotencyKey }
    );
    return response.data;
  },
  async updateCheckItem(itemId: string, data: CheckTemplateItemUpdate): Promise<CheckTemplateItem> {
    const response = await api.put<CheckTemplateItem>(`/equipment-checks/items/${itemId}`, data);
    return response.data;
  },
  async deleteCheckItem(itemId: string): Promise<void> {
    await api.delete(`/equipment-checks/items/${itemId}`);
  },
  async deleteCheckItemsBulk(compartmentId: string, itemIds: string[], idempotencyKey: string) {
    const response = await api.post<import('../types/equipmentCheck').CheckTemplateItemBulkDeleteResult>(
      `/equipment-checks/compartments/${compartmentId}/items/bulk-delete`,
      { item_ids: itemIds, idempotency_key: idempotencyKey }
    );
    return response.data;
  },
  async reorderItems(compartmentId: string, orderedIds: string[]): Promise<void> {
    await api.put(`/equipment-checks/compartments/${compartmentId}/items/reorder`, { ordered_ids: orderedIds });
  },

  // --- Catalog linking ---
  async getInventoryMatches(templateId: string): Promise<InventoryMatchesResult> {
    const response = await api.get<InventoryMatchesResult>(
      `/equipment-checks/templates/${templateId}/inventory-matches`
    );
    return response.data;
  },
  async linkInventoryItems(templateId: string, links: Record<string, string | null>): Promise<InventoryLinkResult> {
    const response = await api.post<InventoryLinkResult>(`/equipment-checks/templates/${templateId}/inventory-links`, {
      links,
    });
    return response.data;
  },

  // =====================================================================
  // Shift Equipment Checks
  // =====================================================================

  async getShiftChecklists(shiftId: string): Promise<ShiftCheckSummary[]> {
    const response = await api.get<ShiftCheckSummary[]>(`/equipment-checks/shifts/${shiftId}/checklists`);
    return asArray(response.data);
  },
  async submitEquipmentCheck(shiftId: string, data: ShiftEquipmentCheckCreate): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.post<ShiftEquipmentCheckRecord>(`/equipment-checks/shifts/${shiftId}/checks`, data);
    return response.data;
  },
  async submitStandaloneCheck(data: StandaloneEquipmentCheckCreate): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.post<ShiftEquipmentCheckRecord>('/equipment-checks/checks', data);
    return response.data;
  },
  async getEquipmentCheck(checkId: string): Promise<ShiftEquipmentCheckRecord> {
    const response = await api.get<ShiftEquipmentCheckRecord>(`/equipment-checks/checks/${checkId}`);
    return response.data;
  },
  async uploadCheckItemPhotos(
    checkId: string,
    itemId: string,
    files: File[]
  ): Promise<{ photoUrls: string[]; count: number }> {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    const response = await api.post<{ photo_urls: string[]; count: number }>(
      `/equipment-checks/checks/${checkId}/items/${itemId}/photos`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return { photoUrls: response.data.photo_urls ?? [], count: response.data.count };
  },
  async getLastCheckResults(templateId: string, apparatusId?: string): Promise<Record<string, LastCheckItemResult>> {
    const response = await api.get<Record<string, LastCheckItemResult>>(
      `/equipment-checks/templates/${templateId}/last-results`,
      { params: apparatusId ? { apparatus_id: apparatusId } : undefined }
    );
    return response.data;
  },
  /** Keyed by compartment id — what each sealed container carried last count. */
  async getLastCheckSeals(templateId: string, apparatusId?: string): Promise<Record<string, LastSealRecord>> {
    const response = await api.get<Record<string, LastSealRecord>>(
      `/equipment-checks/templates/${templateId}/last-seals`,
      { params: apparatusId ? { apparatus_id: apparatusId } : undefined }
    );
    return response.data;
  },

  // --- My Checklists ---
  async getMyChecklists(): Promise<ActiveChecklistRecord[]> {
    const response = await api.get<ActiveChecklistRecord[]>('/equipment-checks/my-checklists');
    return asArray(response.data);
  },
  async getMyChecklistHistory(params?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<ShiftEquipmentCheckRecord[]> {
    const response = await api.get<ShiftEquipmentCheckRecord[]>('/equipment-checks/my-checklists/history', { params });
    return asArray(response.data);
  },

  // =====================================================================
  // Fleet Readiness / Check Log
  // =====================================================================

  async getFleetReadiness(params?: { strip_dates?: number; expiring_days?: number }): Promise<FleetReadinessResponse> {
    const response = await api.get<FleetReadinessResponse>('/equipment-checks/fleet', { params });
    return response.data;
  },

  /**
   * Expected-vs-actual check history.
   *
   * The server decides the scope from the caller's permissions — a member
   * without `inventory.check_view` gets only their own checks and no grid —
   * so there is no client-side flag to get wrong here.
   */
  async getCheckLog(params?: { dates?: number; apparatus_id?: string }): Promise<CheckLogResponse> {
    const response = await api.get<CheckLogResponse>('/equipment-checks/log', { params });
    return response.data;
  },

  // =====================================================================
  // Reports
  // =====================================================================

  async getEquipmentComplianceReport(params?: { date_from?: string; date_to?: string }): Promise<ComplianceReport> {
    const response = await api.get<ComplianceReport>('/equipment-checks/reports/compliance', { params });
    return response.data;
  },
  async getFailureLog(params?: {
    date_from?: string | undefined;
    date_to?: string | undefined;
    apparatus_id?: string | undefined;
    item_name?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): Promise<FailureLogResponse> {
    const response = await api.get<FailureLogResponse>('/equipment-checks/reports/failures', { params });
    return response.data;
  },
  async getItemTrends(params: {
    template_item_id: string;
    date_from?: string;
    date_to?: string;
    interval?: string;
  }): Promise<ItemTrendResponse> {
    const response = await api.get<ItemTrendResponse>('/equipment-checks/reports/item-trends', { params });
    return response.data;
  },
  getReportExportUrl(params: {
    report_type: string;
    date_from?: string;
    date_to?: string;
    apparatus_id?: string;
    template_item_id?: string;
  }): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    return `/api/v1/equipment-checks/reports/export/csv?${searchParams.toString()}`;
  },
  getReportPdfExportUrl(params: {
    report_type: string;
    date_from?: string;
    date_to?: string;
    apparatus_id?: string;
    check_id?: string;
  }): string {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value) searchParams.set(key, value);
    });
    return `/api/v1/equipment-checks/reports/export/pdf?${searchParams.toString()}`;
  },

  async getTemplateChangelog(
    templateId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<TemplateChangeLogResponse> {
    const response = await api.get<TemplateChangeLogResponse>(`/equipment-checks/templates/${templateId}/changelog`, {
      params,
    });
    return response.data;
  },

  getCsvSampleUrl(): string {
    return '/api/v1/equipment-checks/csv-sample';
  },
};
