/**
 * inventoryService — extracted from services/api.ts
 */

import api from './apiClient';
import type {
  UserCheckoutItem, UserInventoryResponse, InventoryCategory, InventoryItem,
  LowStockAlert, MaintenanceRecord, MaintenanceRecordCreate, StorageAreaResponse,
  StorageAreaCreate, EquipmentRequestItem, WriteOffRequestItem, InventoryItemCreate,
  ItemIssuance, InventoryItemsListResponse, ItemHistoryEvent, InventorySummary,
  InventoryCategoryCreate, ScanLookupResponse, BatchCheckoutRequest, BatchCheckoutResponse,
  BatchReturnRequest, BatchReturnResponse, LabelFormat, NFPACompliance, NFPAExposureRecord,
  NFPASummary, NFPARetirementDueItem, MembersInventoryListResponse, InventoryImportResult,
  SizeVariantCreate, BulkIssuanceTarget, BulkIssuanceResponse, IssuanceAllowance, AllowanceCheck,
  ChargeManagementResponse, ReturnRequestItem,
} from './eventServices';

export const inventoryService = {
  async getMembersSummary(search?: string): Promise<MembersInventoryListResponse> {
    const response = await api.get<MembersInventoryListResponse>('/inventory/members-summary', {
      params: search ? { search } : undefined,
    });
    return response.data;
  },

  async getUserInventory(userId: string): Promise<UserInventoryResponse> {
    const response = await api.get<UserInventoryResponse>(`/inventory/users/${userId}/inventory`);
    return response.data;
  },

  async getSummary(): Promise<InventorySummary> {
    const response = await api.get<InventorySummary>('/inventory/summary');
    return response.data;
  },

  async getCategories(itemType?: string, activeOnly: boolean = true): Promise<InventoryCategory[]> {
    const response = await api.get<InventoryCategory[]>('/inventory/categories', {
      params: { item_type: itemType, active_only: activeOnly },
    });
    return response.data;
  },

  async createCategory(data: InventoryCategoryCreate): Promise<InventoryCategory> {
    const response = await api.post<InventoryCategory>('/inventory/categories', data);
    return response.data;
  },

  async getItems(params?: {
    category_id?: string | undefined;
    status?: string | undefined;
    condition?: string | undefined;
    item_type?: string | undefined;
    storage_area_id?: string | undefined;
    search?: string | undefined;
    active_only?: boolean | undefined;
    sort_by?: string | undefined;
    sort_order?: 'asc' | 'desc' | undefined;
    skip?: number | undefined;
    limit?: number | undefined;
  }): Promise<InventoryItemsListResponse> {
    const response = await api.get<InventoryItemsListResponse>('/inventory/items', { params });
    return response.data;
  },

  async getItem(itemId: string): Promise<InventoryItem> {
    const response = await api.get<InventoryItem>(`/inventory/items/${itemId}`);
    return response.data;
  },

  async getItemHistory(itemId: string): Promise<{ events: ItemHistoryEvent[] }> {
    const response = await api.get<{ events: ItemHistoryEvent[] }>(`/inventory/items/${itemId}/history`);
    return response.data;
  },

  async createItem(data: InventoryItemCreate): Promise<InventoryItem> {
    const response = await api.post<InventoryItem>('/inventory/items', data);
    return response.data;
  },

  async updateItem(itemId: string, data: Partial<InventoryItemCreate>): Promise<InventoryItem> {
    const response = await api.patch<InventoryItem>(`/inventory/items/${itemId}`, data);
    return response.data;
  },

  async retireItem(itemId: string, notes?: string): Promise<void> {
    await api.post(`/inventory/items/${itemId}/retire`, { notes });
  },

  async assignItem(itemId: string, userId: string, options?: { assignment_type?: string; assignment_reason?: string }): Promise<{ id: string; item_id: string; user_id: string; is_active: boolean }> {
    const response = await api.post<{ id: string; item_id: string; user_id: string; is_active: boolean }>(`/inventory/items/${itemId}/assign`, {
      item_id: itemId,
      user_id: userId,
      assignment_type: options?.assignment_type ?? 'permanent',
      assignment_reason: options?.assignment_reason,
    });
    return response.data;
  },

  async unassignItem(itemId: string, options?: { return_condition?: string; return_notes?: string }): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/inventory/items/${itemId}/unassign`, {
      return_condition: options?.return_condition,
      return_notes: options?.return_notes,
    });
    return response.data;
  },

  async checkoutItem(data: { item_id: string; user_id: string; expected_return_at?: string; checkout_reason?: string }): Promise<{ id: string }> {
    const response = await api.post<{ id: string }>('/inventory/checkout', data);
    return response.data;
  },

  async checkInItem(checkoutId: string, returnCondition: string, damageNotes?: string): Promise<void> {
    await api.post(`/inventory/checkout/${checkoutId}/checkin`, { return_condition: returnCondition, damage_notes: damageNotes });
  },

  async extendCheckout(checkoutId: string, expectedReturnAt: string): Promise<{ message: string; expected_return_at: string }> {
    const response = await api.patch<{ message: string; expected_return_at: string }>(`/inventory/checkout/${checkoutId}/extend`, { expected_return_at: expectedReturnAt });
    return response.data;
  },

  async getActiveCheckouts(): Promise<{ checkouts: UserCheckoutItem[]; total: number }> {
    const response = await api.get<{ checkouts: UserCheckoutItem[]; total: number }>('/inventory/checkout/active');
    return response.data;
  },

  async getOverdueCheckouts(): Promise<{ checkouts: UserCheckoutItem[]; total: number }> {
    const response = await api.get<{ checkouts: UserCheckoutItem[]; total: number }>('/inventory/checkout/overdue');
    return response.data;
  },

  async getLowStockItems(): Promise<LowStockAlert[]> {
    const response = await api.get<LowStockAlert[]>('/inventory/low-stock');
    return response.data;
  },

  async getMaintenanceDueItems(daysAhead: number = 30): Promise<InventoryItem[]> {
    const response = await api.get<InventoryItem[]>('/inventory/maintenance/due', { params: { days_ahead: daysAhead } });
    return response.data;
  },

  async getItemMaintenanceHistory(itemId: string): Promise<MaintenanceRecord[]> {
    const response = await api.get<MaintenanceRecord[]>(`/inventory/items/${itemId}/maintenance`);
    return response.data;
  },

  async createMaintenanceRecord(data: MaintenanceRecordCreate): Promise<MaintenanceRecord> {
    const response = await api.post<MaintenanceRecord>('/inventory/maintenance', data);
    return response.data;
  },

  async updateMaintenanceRecord(itemId: string, recordId: string, data: Partial<MaintenanceRecordCreate>): Promise<MaintenanceRecord> {
    const response = await api.patch<MaintenanceRecord>(`/inventory/items/${itemId}/maintenance/${recordId}`, data);
    return response.data;
  },

  // Storage Areas
  async getStorageAreas(params?: { location_id?: string; parent_id?: string; flat?: boolean }): Promise<StorageAreaResponse[]> {
    const response = await api.get<StorageAreaResponse[]>('/inventory/storage-areas', { params });
    return response.data;
  },

  async createStorageArea(data: StorageAreaCreate): Promise<StorageAreaResponse> {
    const response = await api.post<StorageAreaResponse>('/inventory/storage-areas', data);
    return response.data;
  },

  async updateStorageArea(areaId: string, data: Partial<StorageAreaCreate>): Promise<StorageAreaResponse> {
    const response = await api.put<StorageAreaResponse>(`/inventory/storage-areas/${areaId}`, data);
    return response.data;
  },

  async deleteStorageArea(areaId: string): Promise<void> {
    await api.delete(`/inventory/storage-areas/${areaId}`);
  },

  // Pool item issuance
  async issueFromPool(itemId: string, userId: string, quantity: number = 1, issueReason?: string): Promise<ItemIssuance> {
    const response = await api.post<ItemIssuance>(`/inventory/items/${itemId}/issue`, {
      user_id: userId,
      quantity,
      issue_reason: issueReason,
    });
    return response.data;
  },

  async returnToPool(issuanceId: string, options?: { return_condition?: string; return_notes?: string; quantity_returned?: number }): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/inventory/issuances/${issuanceId}/return`, {
      return_condition: options?.return_condition,
      return_notes: options?.return_notes,
      quantity_returned: options?.quantity_returned,
    });
    return response.data;
  },

  async getItemIssuances(itemId: string, activeOnly: boolean = true): Promise<ItemIssuance[]> {
    const response = await api.get<ItemIssuance[]>(`/inventory/items/${itemId}/issuances`, {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  // Size variant quick-create
  async createSizeVariants(data: SizeVariantCreate): Promise<{ created_count: number; items: InventoryItem[] }> {
    const response = await api.post<{ created_count: number; items: InventoryItem[] }>('/inventory/items/create-variants', data);
    return response.data;
  },

  // Bulk issuance
  async bulkIssueFromPool(itemId: string, targets: BulkIssuanceTarget[]): Promise<BulkIssuanceResponse> {
    const response = await api.post<BulkIssuanceResponse>(`/inventory/items/${itemId}/bulk-issue`, { targets });
    return response.data;
  },

  // Issuance allowances
  async getAllowances(): Promise<IssuanceAllowance[]> {
    const response = await api.get<IssuanceAllowance[]>('/inventory/allowances');
    return response.data;
  },

  async createAllowance(data: { category_id: string; role_id?: string; max_quantity: number; period_type?: string }): Promise<IssuanceAllowance> {
    const response = await api.post<IssuanceAllowance>('/inventory/allowances', data);
    return response.data;
  },

  async updateAllowance(id: string, data: { max_quantity?: number; period_type?: string; is_active?: boolean }): Promise<IssuanceAllowance> {
    const response = await api.put<IssuanceAllowance>(`/inventory/allowances/${id}`, data);
    return response.data;
  },

  async deleteAllowance(id: string): Promise<void> {
    await api.delete(`/inventory/allowances/${id}`);
  },

  async checkAllowance(userId: string, categoryId: string): Promise<AllowanceCheck> {
    const response = await api.get<AllowanceCheck>(`/inventory/allowances/check/${userId}/${categoryId}`);
    return response.data;
  },

  // Cost recovery
  async updateIssuanceCharge(issuanceId: string, chargeStatus: string, chargeAmount?: number): Promise<ItemIssuance> {
    const response = await api.put<ItemIssuance>(`/inventory/issuances/${issuanceId}/charge`, {
      charge_status: chargeStatus,
      charge_amount: chargeAmount,
    });
    return response.data;
  },

  async getUserIssuances(userId: string, activeOnly: boolean = true): Promise<ItemIssuance[]> {
    const response = await api.get<ItemIssuance[]>(`/inventory/users/${userId}/issuances`, {
      params: { active_only: activeOnly },
    });
    return response.data;
  },

  // Barcode scan / quick-action methods
  async lookupByCode(code: string): Promise<ScanLookupResponse> {
    const response = await api.get<ScanLookupResponse>('/inventory/lookup', {
      params: { code },
    });
    return response.data;
  },

  async batchCheckout(data: BatchCheckoutRequest): Promise<BatchCheckoutResponse> {
    const response = await api.post<BatchCheckoutResponse>('/inventory/batch-checkout', data);
    return response.data;
  },

  async batchReturn(data: BatchReturnRequest): Promise<BatchReturnResponse> {
    const response = await api.post<BatchReturnResponse>('/inventory/batch-return', data);
    return response.data;
  },

  async getLabelFormats(): Promise<{ formats: LabelFormat[] }> {
    const response = await api.get<{ formats: LabelFormat[] }>('/inventory/labels/formats');
    return response.data;
  },

  async generateBarcodeLabels(
    itemIds: string[],
    labelFormat: string = 'letter',
    customWidth?: number,
    customHeight?: number,
  ): Promise<Blob> {
    const response = await api.post<Blob>('/inventory/labels/generate', {
      item_ids: itemIds,
      label_format: labelFormat,
      custom_width: customWidth,
      custom_height: customHeight,
    }, {
      responseType: 'blob',
    });
    return response.data;
  },

  async updateCategory(categoryId: string, data: Partial<InventoryCategoryCreate>): Promise<InventoryCategory> {
    const response = await api.patch<InventoryCategory>(`/inventory/categories/${categoryId}`, data);
    return response.data;
  },

  async exportItemsCsv(params?: { category_id?: string | undefined; status?: string | undefined; search?: string | undefined }): Promise<Blob> {
    const response = await api.get<Blob>('/inventory/items/export', { params, responseType: 'blob' });
    return response.data;
  },

  async downloadImportTemplate(): Promise<Blob> {
    const response = await api.get<Blob>('/inventory/items/import-template', { responseType: 'blob' });
    return response.data;
  },

  async importItemsCsv(file: File): Promise<InventoryImportResult> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<InventoryImportResult>('/inventory/items/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  // Equipment requests
  async createEquipmentRequest(data: { item_name: string; item_id?: string | undefined; category_id?: string | undefined; quantity?: number; request_type?: string; priority?: string; reason?: string | undefined }): Promise<{ id: string; item_name: string; status: string; message: string }> {
    const response = await api.post<{ id: string; item_name: string; status: string; message: string }>('/inventory/requests', data);
    return response.data;
  },

  async getEquipmentRequests(params?: { status?: string; mine_only?: boolean }): Promise<{ requests: EquipmentRequestItem[]; total: number }> {
    const response = await api.get<{ requests: EquipmentRequestItem[]; total: number }>('/inventory/requests', { params });
    return response.data;
  },

  async reviewEquipmentRequest(requestId: string, data: { status: string; review_notes?: string | undefined }): Promise<{ id: string; status: string; message: string }> {
    const response = await api.put<{ id: string; status: string; message: string }>(`/inventory/requests/${requestId}/review`, data);
    return response.data;
  },

  // Write-off requests
  async getWriteOffRequests(params?: { status?: string }): Promise<WriteOffRequestItem[]> {
    const response = await api.get<WriteOffRequestItem[]>('/inventory/write-offs', { params });
    return response.data;
  },

  async createWriteOffRequest(data: { item_id: string; reason: string; description: string }): Promise<WriteOffRequestItem> {
    const response = await api.post<WriteOffRequestItem>('/inventory/write-offs', data);
    return response.data;
  },

  async reviewWriteOff(writeOffId: string, data: { status: string; review_notes?: string | undefined }): Promise<{ id: string; status: string; message: string }> {
    const response = await api.put<{ id: string; status: string; message: string }>(`/inventory/write-offs/${writeOffId}/review`, data);
    return response.data;
  },

  // --- NFPA Compliance ---

  async getNFPACompliance(itemId: string): Promise<NFPACompliance> {
    const response = await api.get<NFPACompliance>(`/inventory/items/${itemId}/nfpa-compliance`);
    return response.data;
  },

  async createNFPACompliance(itemId: string, data: Partial<NFPACompliance>): Promise<NFPACompliance> {
    const response = await api.post<NFPACompliance>(`/inventory/items/${itemId}/nfpa-compliance`, data);
    return response.data;
  },

  async updateNFPACompliance(itemId: string, data: Partial<NFPACompliance>): Promise<NFPACompliance> {
    const response = await api.patch<NFPACompliance>(`/inventory/items/${itemId}/nfpa-compliance`, data);
    return response.data;
  },

  async deleteNFPACompliance(itemId: string): Promise<void> {
    await api.delete(`/inventory/items/${itemId}/nfpa-compliance`);
  },

  async getExposureRecords(itemId: string): Promise<NFPAExposureRecord[]> {
    const response = await api.get<NFPAExposureRecord[]>(`/inventory/items/${itemId}/exposures`);
    return response.data;
  },

  async createExposureRecord(itemId: string, data: Omit<NFPAExposureRecord, 'id' | 'item_id' | 'organization_id' | 'created_at' | 'updated_at'>): Promise<NFPAExposureRecord> {
    const response = await api.post<NFPAExposureRecord>(`/inventory/items/${itemId}/exposures`, data);
    return response.data;
  },

  async getNFPASummary(): Promise<NFPASummary> {
    const response = await api.get<NFPASummary>('/inventory/nfpa/summary');
    return response.data;
  },

  async getNFPARetirementDue(daysAhead = 180): Promise<{ items: NFPARetirementDueItem[]; total: number }> {
    const response = await api.get<{ items: NFPARetirementDueItem[]; total: number }>('/inventory/nfpa/retirement-due', { params: { days_ahead: daysAhead } });
    return response.data;
  },

  // Charge management
  async getCharges(chargeStatus?: string): Promise<ChargeManagementResponse> {
    const response = await api.get<ChargeManagementResponse>('/inventory/charges', {
      params: chargeStatus ? { charge_status: chargeStatus } : undefined,
    });
    return response.data;
  },

  // Return requests
  async createReturnRequest(data: {
    return_type: 'assignment' | 'issuance' | 'checkout';
    item_id: string;
    assignment_id?: string | undefined;
    issuance_id?: string | undefined;
    checkout_id?: string | undefined;
    quantity_returning?: number | undefined;
    reported_condition?: string | undefined;
    member_notes?: string | undefined;
  }): Promise<ReturnRequestItem> {
    const response = await api.post<ReturnRequestItem>('/inventory/return-requests', data);
    return response.data;
  },

  async getReturnRequests(params?: { status?: string | undefined; mine_only?: boolean | undefined }): Promise<ReturnRequestItem[]> {
    const response = await api.get<ReturnRequestItem[]>('/inventory/return-requests', { params });
    return response.data;
  },

  async reviewReturnRequest(requestId: string, data: { status: string; review_notes?: string | undefined; override_condition?: string | undefined }): Promise<{ id: string; status: string; message: string }> {
    const response = await api.put<{ id: string; status: string; message: string }>(`/inventory/return-requests/${requestId}/review`, data);
    return response.data;
  },

  // Issuance history (all records, active + returned)
  async getUserIssuanceHistory(userId: string): Promise<ItemIssuance[]> {
    const response = await api.get<ItemIssuance[]>(`/inventory/users/${userId}/issuance-history`);
    return response.data;
  },
};

// ============================================
// Forms Types & Service
// ============================================

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormField {
  id: string;
  form_id: string;
  label: string;
  field_type: string;
  placeholder?: string | undefined;
  help_text?: string | undefined;
  default_value?: string | undefined;
  required: boolean;
  min_length?: number | undefined;
  max_length?: number | undefined;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string | undefined;
  options?: FormFieldOption[] | undefined;
  condition_field_id?: string | undefined;
  condition_operator?: string | undefined;
  condition_value?: string | undefined;
  sort_order: number;
  width: string;
  created_at: string;
  updated_at: string;
}

export interface FormFieldCreate {
  label: string;
  field_type: string;
  placeholder?: string | undefined;
  help_text?: string | undefined;
  default_value?: string | undefined;
  required?: boolean;
  min_length?: number | undefined;
  max_length?: number | undefined;
  min_value?: number;
  max_value?: number;
  validation_pattern?: string | undefined;
  options?: FormFieldOption[] | undefined;
  condition_field_id?: string | undefined;
  condition_operator?: string | undefined;
  condition_value?: string | undefined;
  sort_order?: number;
  width?: string;
}

export interface FormIntegration {
  id: string;
  form_id: string;
  organization_id: string;
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FormIntegrationCreate {
  target_module: string;
  integration_type: string;
  field_mappings: Record<string, string>;
  is_active?: boolean;
}

export interface MemberLookupResult {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  membership_number?: string;
  rank?: string;
  station?: string;
  email?: string;
}

export interface MemberLookupResponse {
  members: MemberLookupResult[];
  total: number;
}

export interface FormDef {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  category: string;
  status: string;
  allow_multiple_submissions: boolean;
  require_authentication: boolean;
  notify_on_submission: boolean;
  notification_emails?: string[];
  is_public: boolean;
  public_slug?: string;
  integration_type?: string;
  version: number;
  is_template: boolean;
  field_count?: number;
  submission_count?: number;
  created_at: string;
  updated_at: string;
  published_at?: string;
  created_by?: string;
}

export interface FormDetailDef extends FormDef {
  fields: FormField[];
  integrations: FormIntegration[];
}

export interface FormCreate {
  name: string;
  description?: string | undefined;
  category?: string | undefined;
  allow_multiple_submissions?: boolean | undefined;
  require_authentication?: boolean | undefined;
  notify_on_submission?: boolean | undefined;
  notification_emails?: string[] | undefined;
  is_public?: boolean | undefined;
  integration_type?: string | undefined;
  fields?: FormFieldCreate[] | undefined;
}

export interface FormUpdate {
  name?: string;
  description?: string;
  category?: string;
  status?: string;
  allow_multiple_submissions?: boolean;
  require_authentication?: boolean;
  notify_on_submission?: boolean;
  notification_emails?: string[];
  is_public?: boolean;
}

export interface FormsListResponse {
  forms: FormDef[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormSubmission {
  id: string;
  organization_id: string;
  form_id: string;
  submitted_by?: string;
  submitted_at: string;
  data: Record<string, unknown>;
  submitter_name?: string;
  submitter_email?: string;
  is_public_submission: boolean;
  integration_processed: boolean;
  integration_result?: Record<string, unknown>;
  created_at: string;
}

export interface SubmissionsListResponse {
  submissions: FormSubmission[];
  total: number;
  skip: number;
  limit: number;
}

export interface FormsSummary {
  total_forms: number;
  published_forms: number;
  draft_forms: number;
  total_submissions: number;
  submissions_this_month: number;
  public_forms: number;
}

// Public form types (no auth required)
export interface PublicFormField {
  id: string;
  label: string;
  field_type: string;
  placeholder?: string;
  help_text?: string;
  default_value?: string;
  required: boolean;
  min_length?: number;
  max_length?: number;
  min_value?: number;
  max_value?: number;
  options?: FormFieldOption[];
  condition_field_id?: string;
  condition_operator?: string;
  condition_value?: string;
  sort_order: number;
  width: string;
}

export interface PublicFormDef {
  id: string;
  name: string;
  description?: string;
  category: string;
  allow_multiple_submissions: boolean;
  fields: PublicFormField[];
  organization_name?: string;
}

export interface PublicFormSubmissionResponse {
  id: string;
  form_name: string;
  submitted_at: string;
  message: string;
}
