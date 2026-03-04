/**
 * eventServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { CheckInMonitoringStats, CheckInRequest, Event, EventCancel, EventCreate, EventListItem, EventStats, EventUpdate, RSVP, RSVPCreate } from '../types/event';
import type { DocumentFolder } from './formsServices';

export const eventService = {
  /**
   * Get all events with optional filtering
   */
  async getEvents(params?: {
    event_type?: string;
    start_after?: string;
    start_before?: string;
    end_after?: string;
    end_before?: string;
    include_cancelled?: boolean;
    skip?: number;
    limit?: number;
  }): Promise<EventListItem[]> {
    const response = await api.get<EventListItem[]>('/events', { params });
    return response.data;
  },

  /**
   * Create a new event
   */
  async createEvent(eventData: EventCreate): Promise<Event> {
    const response = await api.post<Event>('/events', eventData);
    return response.data;
  },

  /**
   * Get a specific event
   */
  async getEvent(eventId: string): Promise<Event> {
    const response = await api.get<Event>(`/events/${eventId}`);
    return response.data;
  },

  /**
   * Update an event
   */
  async updateEvent(eventId: string, eventData: EventUpdate): Promise<Event> {
    const response = await api.patch<Event>(`/events/${eventId}`, eventData);
    return response.data;
  },

  /**
   * Delete an event
   */
  async deleteEvent(eventId: string): Promise<void> {
    await api.delete(`/events/${eventId}`);
  },

  /**
   * Duplicate an event (copies all settings, no RSVPs)
   */
  async duplicateEvent(eventId: string): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/duplicate`);
    return response.data;
  },

  /**
   * Cancel an event
   */
  async cancelEvent(eventId: string, cancelData: EventCancel): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/cancel`, cancelData);
    return response.data;
  },

  /**
   * Create or update an RSVP
   */
  async createOrUpdateRSVP(eventId: string, rsvpData: RSVPCreate): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/rsvp`, rsvpData);
    return response.data;
  },

  /**
   * Get all RSVPs for an event
   */
  async getEventRSVPs(eventId: string, status_filter?: string): Promise<RSVP[]> {
    const params = status_filter ? { status_filter } : undefined;
    const response = await api.get<RSVP[]>(`/events/${eventId}/rsvps`, { params });
    return response.data;
  },

  /**
   * Check in an attendee
   */
  async checkInAttendee(eventId: string, checkInData: CheckInRequest): Promise<RSVP> {
    const response = await api.post<RSVP>(`/events/${eventId}/check-in`, checkInData);
    return response.data;
  },

  /**
   * Get event statistics
   */
  async getEventStats(eventId: string): Promise<EventStats> {
    const response = await api.get<EventStats>(`/events/${eventId}/stats`);
    return response.data;
  },

  /**
   * Get eligible members for check-in
   */
  async getEligibleMembers(eventId: string): Promise<Array<{ id: string; first_name: string; last_name: string; email: string }>> {
    const response = await api.get<Array<{ id: string; first_name: string; last_name: string; email: string }>>(`/events/${eventId}/eligible-members`);
    return response.data;
  },

  /**
   * Record actual start and end times for an event
   */
  async recordActualTimes(eventId: string, times: import('../types/event').RecordActualTimes): Promise<import('../types/event').Event> {
    const response = await api.post<import('../types/event').Event>(`/events/${eventId}/record-times`, times);
    return response.data;
  },

  /**
   * Get QR code check-in data for an event
   */
  async getQRCheckInData(eventId: string): Promise<import('../types/event').QRCheckInData> {
    const response = await api.get<import('../types/event').QRCheckInData>(`/events/${eventId}/qr-check-in-data`);
    return response.data;
  },

  /**
   * Check in to or out of an event (self-check-in/out via QR code)
   */
  async selfCheckIn(eventId: string, isCheckout: boolean = false): Promise<import('../types/event').RSVP> {
    const response = await api.post<import('../types/event').RSVP>(
      `/events/${eventId}/self-check-in`,
      { is_checkout: isCheckout }
    );
    return response.data;
  },

  /**
   * Get real-time check-in monitoring statistics
   */
  async getCheckInMonitoring(eventId: string): Promise<CheckInMonitoringStats> {
    const response = await api.get<CheckInMonitoringStats>(`/events/${eventId}/check-in-monitoring`);
    return response.data;
  },

  /**
   * Add an attendee to an event (manager action)
   */
  async addAttendee(eventId: string, data: import('../types/event').ManagerAddAttendee): Promise<import('../types/event').RSVP> {
    const response = await api.post<import('../types/event').RSVP>(`/events/${eventId}/add-attendee`, data);
    return response.data;
  },

  /**
   * Override attendance details for an RSVP (manager action)
   */
  async overrideAttendance(eventId: string, userId: string, data: import('../types/event').RSVPOverride): Promise<import('../types/event').RSVP> {
    const response = await api.patch<import('../types/event').RSVP>(`/events/${eventId}/rsvps/${userId}/override`, data);
    return response.data;
  },

  /**
   * Remove an attendee's RSVP from an event (manager action)
   */
  async removeAttendee(eventId: string, userId: string): Promise<void> {
    await api.delete(`/events/${eventId}/rsvps/${userId}`);
  },

  // Event Templates
  async getTemplates(includeInactive?: boolean): Promise<import('../types/event').EventTemplate[]> {
    const params = includeInactive ? { include_inactive: true } : undefined;
    const response = await api.get<import('../types/event').EventTemplate[]>('/events/templates', { params });
    return response.data;
  },

  async createTemplate(data: import('../types/event').EventTemplateCreate): Promise<import('../types/event').EventTemplate> {
    const response = await api.post<import('../types/event').EventTemplate>('/events/templates', data);
    return response.data;
  },

  async getTemplate(templateId: string): Promise<import('../types/event').EventTemplate> {
    const response = await api.get<import('../types/event').EventTemplate>(`/events/templates/${templateId}`);
    return response.data;
  },

  async updateTemplate(templateId: string, data: Partial<import('../types/event').EventTemplateCreate>): Promise<import('../types/event').EventTemplate> {
    const response = await api.patch<import('../types/event').EventTemplate>(`/events/templates/${templateId}`, data);
    return response.data;
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await api.delete(`/events/templates/${templateId}`);
  },

  // Recurring Events
  async createRecurringEvent(data: import('../types/event').RecurringEventCreate): Promise<import('../types/event').Event[]> {
    const response = await api.post<import('../types/event').Event[]>('/events/recurring', data);
    return response.data;
  },

  // Module Settings
  async getModuleSettings(): Promise<import('../types/event').EventModuleSettings> {
    const response = await api.get<import('../types/event').EventModuleSettings>('/events/settings');
    return response.data;
  },
  async updateModuleSettings(data: Partial<import('../types/event').EventModuleSettings>): Promise<import('../types/event').EventModuleSettings> {
    const response = await api.patch<import('../types/event').EventModuleSettings>('/events/settings', data);
    return response.data;
  },
  async getVisibleEventTypes(): Promise<import('../types/event').EventType[]> {
    const response = await api.get<{ visible_event_types: import('../types/event').EventType[] }>('/events/visible-event-types');
    return response.data.visible_event_types;
  },
  async getVisibleEventTypesWithCategories(): Promise<{
    visible_event_types: import('../types/event').EventType[];
    custom_event_categories: import('../types/event').EventCategoryConfig[];
    visible_custom_categories: string[];
  }> {
    const response = await api.get<{
      visible_event_types: import('../types/event').EventType[];
      custom_event_categories: import('../types/event').EventCategoryConfig[];
      visible_custom_categories: string[];
    }>('/events/visible-event-types');
    return response.data;
  },

  async getEventFolder(eventId: string): Promise<DocumentFolder> {
    const response = await api.get<DocumentFolder>(`/events/${eventId}/folder`);
    return response.data;
  },

  // External Attendees
  async getExternalAttendees(eventId: string): Promise<Array<Record<string, unknown>>> {
    const response = await api.get<Array<Record<string, unknown>>>(`/events/${eventId}/external-attendees`);
    return response.data;
  },
  async addExternalAttendee(eventId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/events/${eventId}/external-attendees`, data);
    return response.data;
  },
  async updateExternalAttendee(eventId: string, attendeeId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/events/${eventId}/external-attendees/${attendeeId}`, data);
    return response.data;
  },
  async checkInExternalAttendee(eventId: string, attendeeId: string): Promise<Record<string, unknown>> {
    const response = await api.patch<Record<string, unknown>>(`/events/${eventId}/external-attendees/${attendeeId}/check-in`);
    return response.data;
  },
  async removeExternalAttendee(eventId: string, attendeeId: string): Promise<void> {
    await api.delete(`/events/${eventId}/external-attendees/${attendeeId}`);
  },
};

// ============================================
// Event Request Pipeline Service
// ============================================

export const eventRequestService = {
  async listRequests(params?: { status?: string; outreach_type?: string }): Promise<import('../types/event').EventRequestListItem[]> {
    const response = await api.get<import('../types/event').EventRequestListItem[]>('/event-requests', { params });
    return response.data;
  },
  async getRequest(requestId: string): Promise<import('../types/event').EventRequest> {
    const response = await api.get<import('../types/event').EventRequest>(`/event-requests/${requestId}`);
    return response.data;
  },
  async updateRequestStatus(requestId: string, data: { status: string; notes?: string | undefined; decline_reason?: string | undefined; assigned_to?: string | undefined; event_id?: string | undefined }): Promise<{ message: string; status: string }> {
    const response = await api.patch<{ message: string; status: string }>(`/event-requests/${requestId}/status`, data);
    return response.data;
  },
  async checkPublicStatus(token: string): Promise<import('../types/event').EventRequestPublicStatus> {
    const response = await api.get<import('../types/event').EventRequestPublicStatus>(`/event-requests/status/${token}`);
    return response.data;
  },
  async getOutreachTypeLabels(organizationId?: string): Promise<Record<string, string>> {
    const params = organizationId ? { organization_id: organizationId } : {};
    const response = await api.get<Record<string, string>>('/event-requests/types/labels', { params });
    return response.data;
  },
  async updateTaskCompletion(requestId: string, data: { task_id: string; completed: boolean; notes?: string }): Promise<{ message: string; task_completions: Record<string, unknown>; status: string }> {
    const response = await api.patch<{ message: string; task_completions: Record<string, unknown>; status: string }>(`/event-requests/${requestId}/tasks`, data);
    return response.data;
  },
  async assignRequest(requestId: string, data: { assigned_to: string; notes?: string }): Promise<{ message: string; assigned_to: string; assignee_name: string }> {
    const response = await api.patch<{ message: string; assigned_to: string; assignee_name: string }>(`/event-requests/${requestId}/assign`, data);
    return response.data;
  },
  async addComment(requestId: string, data: { message: string }): Promise<import('../types/event').EventRequestActivity> {
    const response = await api.post<import('../types/event').EventRequestActivity>(`/event-requests/${requestId}/comments`, data);
    return response.data;
  },
  async scheduleRequest(requestId: string, data: { event_date: string; event_end_date?: string | undefined; location_id?: string | undefined; notes?: string | undefined; create_calendar_event?: boolean | undefined }): Promise<{ message: string; status: string; event_date: string; event_id?: string }> {
    const response = await api.patch<{ message: string; status: string; event_date: string; event_id?: string }>(`/event-requests/${requestId}/schedule`, data);
    return response.data;
  },
  async postponeRequest(requestId: string, data: { reason?: string | undefined; new_event_date?: string | undefined; new_event_end_date?: string | undefined }): Promise<{ message: string; status: string }> {
    const response = await api.patch<{ message: string; status: string }>(`/event-requests/${requestId}/postpone`, data);
    return response.data;
  },
  async publicCancelRequest(token: string, data: { reason?: string | undefined }): Promise<{ message: string; status: string }> {
    const response = await api.post<{ message: string; status: string }>(`/event-requests/status/${token}/cancel`, data);
    return response.data;
  },
  async sendTemplateEmail(requestId: string, data: { template_id: string; additional_context?: Record<string, string> }): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>(`/event-requests/${requestId}/send-email`, data);
    return response.data;
  },
  async listEmailTemplates(): Promise<import('../types/event').EmailTemplate[]> {
    const response = await api.get<import('../types/event').EmailTemplate[]>('/event-requests/email-templates');
    return response.data;
  },
  async createEmailTemplate(data: { name: string; subject: string; body_html: string; body_text?: string | undefined; trigger?: string | undefined; trigger_days_before?: number | undefined }): Promise<import('../types/event').EmailTemplate> {
    const response = await api.post<import('../types/event').EmailTemplate>('/event-requests/email-templates', data);
    return response.data;
  },
  async updateEmailTemplate(templateId: string, data: Partial<{ name: string; subject: string; body_html: string; body_text: string; trigger: string; trigger_days_before: number; is_active: number }>): Promise<import('../types/event').EmailTemplate> {
    const response = await api.patch<import('../types/event').EmailTemplate>(`/event-requests/email-templates/${templateId}`, data);
    return response.data;
  },
  async deleteEmailTemplate(templateId: string): Promise<{ message: string }> {
    const response = await api.delete<{ message: string }>(`/event-requests/email-templates/${templateId}`);
    return response.data;
  },
  async generateForm(): Promise<{ message: string; form_id: string; public_slug: string; public_url: string }> {
    const response = await api.post<{ message: string; form_id: string; public_slug: string; public_url: string }>('/event-requests/generate-form');
    return response.data;
  },
};

export interface UserInventoryItem {
  assignment_id: string;
  item_id: string;
  item_name: string;
  serial_number?: string;
  asset_tag?: string;
  condition: string;
  assigned_date: string;
  category_name?: string;
  quantity?: number;
}

export interface UserCheckoutItem {
  checkout_id: string;
  item_id: string;
  item_name: string;
  user_id?: string;
  user_name?: string;
  checked_out_at: string;
  expected_return_at?: string;
  is_overdue: boolean;
  checkout_reason?: string;
}

export interface UserIssuedItem {
  issuance_id: string;
  item_id: string;
  item_name: string;
  quantity_issued: number;
  issued_at: string;
  size?: string;
  category_name?: string;
}

export interface UserInventoryResponse {
  permanent_assignments: UserInventoryItem[];
  active_checkouts: UserCheckoutItem[];
  issued_items: UserIssuedItem[];
}

export interface InventoryCategory {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  item_type: string;
  parent_category_id?: string;
  requires_assignment: boolean;
  requires_serial_number: boolean;
  requires_maintenance: boolean;
  low_stock_threshold?: number;
  nfpa_tracking_enabled: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  organization_id: string;
  category_id?: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  asset_tag?: string;
  barcode?: string;
  purchase_date?: string;
  purchase_price?: number;
  replacement_cost?: number;
  vendor?: string;
  warranty_expiration?: string;
  location_id?: string;
  storage_location?: string;
  storage_area_id?: string;
  size?: string;
  color?: string;
  station?: string;
  condition: string;
  status: string;
  status_notes?: string;
  tracking_type: string;  // "individual" or "pool"
  quantity: number;
  quantity_issued: number;
  unit_of_measure?: string;
  last_inspection_date?: string;
  next_inspection_due?: string;
  inspection_interval_days?: number;
  assigned_to_user_id?: string;
  assigned_date?: string;
  min_rank_order?: number | null;
  restricted_to_positions?: string[] | null;
  notes?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LowStockAlert {
  category_id: string;
  category_name: string;
  item_type: string;
  current_stock: number;
  threshold: number;
  items?: Array<{ name: string; quantity: number }>;
}

export interface MaintenanceRecord {
  id: string;
  organization_id: string;
  item_id: string;
  maintenance_type: string;
  scheduled_date?: string;
  completed_date?: string;
  next_due_date?: string;
  performed_by?: string;
  vendor_name?: string;
  cost?: number;
  condition_before?: string;
  condition_after?: string;
  description?: string;
  parts_replaced?: string[];
  parts_cost?: number;
  labor_hours?: number;
  passed?: boolean;
  notes?: string;
  issues_found?: string[];
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceRecordCreate {
  item_id: string;
  maintenance_type: string;
  scheduled_date?: string;
  completed_date?: string;
  next_due_date?: string;
  performed_by?: string;
  vendor_name?: string;
  cost?: number;
  condition_before?: string;
  condition_after?: string;
  description?: string;
  parts_replaced?: string[];
  parts_cost?: number;
  labor_hours?: number;
  passed?: boolean;
  notes?: string;
  issues_found?: string[];
  is_completed?: boolean;
}

export interface StorageAreaResponse {
  id: string;
  organization_id: string;
  name: string;
  label?: string;
  description?: string;
  storage_type: string;
  parent_id?: string;
  location_id?: string;
  barcode?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  children: StorageAreaResponse[];
  item_count: number;
  location_name?: string;
  parent_name?: string;
}

export interface StorageAreaCreate {
  name: string;
  label?: string | undefined;
  description?: string | undefined;
  storage_type: string;
  parent_id?: string | undefined;
  location_id?: string | undefined;
  barcode?: string | undefined;
  sort_order?: number | undefined;
}

export interface EquipmentRequestItem {
  id: string;
  requester_id: string;
  requester_name?: string;
  item_name: string;
  item_id?: string;
  category_id?: string;
  quantity: number;
  request_type: string;
  priority: string;
  reason?: string;
  status: string;
  reviewed_by?: string;
  reviewer_name?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface WriteOffRequestItem {
  id: string;
  item_id?: string;
  item_name: string;
  item_serial_number?: string;
  item_asset_tag?: string;
  item_value?: number;
  reason: string;
  description: string;
  status: string;
  requested_by?: string;
  requester_name?: string;
  reviewed_by?: string;
  reviewer_name?: string;
  reviewed_at?: string;
  review_notes?: string;
  clearance_id?: string;
  created_at?: string;
}

export interface InventoryItemCreate {
  category_id?: string | undefined;
  name: string;
  description?: string | undefined;
  manufacturer?: string | undefined;
  model_number?: string | undefined;
  serial_number?: string | undefined;
  asset_tag?: string | undefined;
  barcode?: string | undefined;
  purchase_date?: string | undefined;
  purchase_price?: number | undefined;
  purchase_order?: string | undefined;
  vendor?: string | undefined;
  warranty_expiration?: string | undefined;
  expected_lifetime_years?: number | undefined;
  current_value?: number | undefined;
  replacement_cost?: number | undefined;
  size?: string | undefined;
  color?: string | undefined;
  weight?: number | undefined;
  location_id?: string | undefined;
  storage_location?: string | undefined;
  storage_area_id?: string | undefined;
  station?: string | undefined;
  condition?: string | undefined;
  status?: string | undefined;
  tracking_type?: string | undefined;
  quantity?: number | undefined;
  unit_of_measure?: string | undefined;
  inspection_interval_days?: number | undefined;
  min_rank_order?: number | null | undefined;
  restricted_to_positions?: string[] | null | undefined;
  notes?: string | undefined;
}

export interface ItemIssuance {
  id: string;
  organization_id: string;
  item_id: string;
  user_id: string;
  quantity_issued: number;
  issued_at: string;
  returned_at?: string;
  issued_by?: string;
  returned_by?: string;
  issue_reason?: string;
  return_condition?: string;
  return_notes?: string;
  is_returned: boolean;
  unit_cost_at_issuance?: number;
  charge_status?: string;  // "none", "pending", "charged", "waived"
  charge_amount?: number;
  created_at: string;
  updated_at: string;
}

export interface SizeVariantCreate {
  base_name: string;
  sizes: string[];
  colors?: string[] | undefined;
  category_id?: string | undefined;
  quantity_per_variant?: number | undefined;
  replacement_cost?: number | undefined;
  purchase_price?: number | undefined;
  tracking_type?: string | undefined;
  unit_of_measure?: string | undefined;
  location_id?: string | undefined;
  storage_area_id?: string | undefined;
  station?: string | undefined;
  notes?: string | undefined;
}

export interface BulkIssuanceTarget {
  user_id: string;
  quantity?: number;
  issue_reason?: string;
}

export interface BulkIssuanceResponse {
  item_id: string;
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    user_id: string;
    success: boolean;
    issuance_id?: string;
    error?: string;
  }>;
}

export interface IssuanceAllowance {
  id: string;
  organization_id: string;
  category_id: string;
  role_id?: string;
  max_quantity: number;
  period_type: string;
  is_active: boolean;
  category_name?: string;
  role_name?: string;
}

export interface AllowanceCheck {
  category_id: string;
  category_name?: string;
  max_quantity: number;
  issued_this_period: number;
  remaining: number;
  period_type: string;
}

export interface InventoryItemsListResponse {
  items: InventoryItem[];
  total: number;
  skip: number;
  limit: number;
}

export interface InventoryImportResult {
  imported: number;
  failed: number;
  total_rows: number;
  errors: Array<{ row: number; error: string }>;
  warnings: string[];
}

export interface ItemHistoryEvent {
  type: 'assignment' | 'return' | 'checkout' | 'checkin' | 'issuance' | 'issuance_return' | 'maintenance';
  id: string;
  date: string;
  summary: string;
  details: Record<string, unknown>;
}

export interface InventorySummary {
  total_items: number;
  items_by_status: Record<string, number>;
  items_by_condition: Record<string, number>;
  total_value: number;
  active_checkouts: number;
  overdue_checkouts: number;
  maintenance_due_count: number;
}

export interface InventoryCategoryCreate {
  name: string;
  description?: string | undefined;
  item_type: string;
  requires_assignment?: boolean | undefined;
  requires_serial_number?: boolean | undefined;
  requires_maintenance?: boolean | undefined;
  low_stock_threshold?: number | undefined;
  nfpa_tracking_enabled?: boolean | undefined;
}

// Scan / Quick-Action Types
export interface ScanLookupResult {
  item: InventoryItem;
  matched_field: string;
  matched_value: string;
}

export interface ScanLookupResponse {
  results: ScanLookupResult[];
  total: number;
}

export interface BatchScanItem {
  code: string;
  item_id?: string;
  quantity?: number;
}

export interface BatchCheckoutRequest {
  user_id: string;
  items: BatchScanItem[];
  reason?: string;
}

export interface BatchCheckoutResultItem {
  code: string;
  item_name: string;
  item_id: string;
  action: string;
  success: boolean;
  error?: string;
}

export interface BatchCheckoutResponse {
  user_id: string;
  total_scanned: number;
  successful: number;
  failed: number;
  results: BatchCheckoutResultItem[];
}

export interface BatchReturnItem {
  code: string;
  item_id?: string;
  return_condition?: string;
  damage_notes?: string;
  quantity?: number;
}

export interface BatchReturnRequest {
  user_id: string;
  items: BatchReturnItem[];
  notes?: string;
}

export interface BatchReturnResultItem {
  code: string;
  item_name: string;
  item_id: string;
  action: string;
  success: boolean;
  error?: string;
}

export interface BatchReturnResponse {
  user_id: string;
  total_scanned: number;
  successful: number;
  failed: number;
  results: BatchReturnResultItem[];
}

export interface MemberInventorySummary {
  user_id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  membership_number?: string;
  permanent_count: number;
  checkout_count: number;
  issued_count: number;
  overdue_count: number;
  total_items: number;
}

export interface MembersInventoryListResponse {
  members: MemberInventorySummary[];
  total: number;
}

export interface LabelFormat {
  id: string;
  description: string;
  type: 'sheet' | 'thermal';
  width?: number;
  height?: number;
}

// NFPA 1851/1852 Compliance Types

export interface NFPACompliance {
  id: string;
  item_id: string;
  organization_id: string;
  manufacture_date?: string | undefined;
  first_in_service_date?: string | undefined;
  expected_retirement_date?: string | undefined;
  retirement_reason?: string | undefined;
  is_retired_by_age: boolean;
  ensemble_id?: string | undefined;
  ensemble_role?: string | undefined;
  cylinder_manufacture_date?: string | undefined;
  cylinder_expiration_date?: string | undefined;
  hydrostatic_test_date?: string | undefined;
  hydrostatic_test_due?: string | undefined;
  flow_test_date?: string | undefined;
  flow_test_due?: string | undefined;
  contamination_level?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface NFPAExposureRecord {
  id: string;
  item_id: string;
  organization_id: string;
  exposure_type: string;
  exposure_date: string;
  incident_number?: string | undefined;
  description?: string | undefined;
  decon_required: boolean;
  decon_completed: boolean;
  decon_completed_date?: string | undefined;
  decon_method?: string | undefined;
  user_id?: string | undefined;
  created_at: string;
  updated_at: string;
}

export interface NFPASummary {
  total_nfpa_items: number;
  nearing_retirement: number;
  overdue_inspection: number;
  pending_decon: number;
  ensembles_count: number;
}

export interface NFPARetirementDueItem {
  item_id: string;
  item_name: string;
  serial_number?: string;
  manufacture_date?: string;
  expected_retirement_date?: string;
  days_remaining?: number;
  ensemble_id?: string;
}
