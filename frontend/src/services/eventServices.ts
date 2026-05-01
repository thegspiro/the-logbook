/**
 * eventServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { CheckInMonitoringStats, CheckInRequest, Event, EventCancel, EventCreate, EventListItem, EventStats, EventUpdate, RSVP, RSVPCreate } from '../types/event';
import type { DocumentFolder } from './formsServices';
import { enqueueGeneric } from '../utils/genericOfflineQueue';
import { usePendingSyncStore } from '../stores/pendingSyncStore';

export interface CSVImportRowError {
  row: number;
  error: string;
}

export interface CSVImportResponse {
  imported_count: number;
  errors: CSVImportRowError[];
}

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
    include_drafts?: boolean;
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
   * Publish a draft event
   */
  async publishEvent(eventId: string): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/publish`);
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
   * Delete all events in a recurring series
   */
  async deleteEventSeries(parentEventId: string, deleteFutureOnly = false): Promise<void> {
    await api.delete(`/events/${parentEventId}/series?delete_future_only=${deleteFutureOnly}`);
  },

  /**
   * Duplicate an event (copies all settings, no RSVPs)
   */
  async duplicateEvent(eventId: string): Promise<Event> {
    const response = await api.post<Event>(`/events/${eventId}/duplicate`);
    return response.data;
  },

  /**
   * Update this event and all future events in the recurring series
   */
  async updateFutureEvents(eventId: string, data: EventUpdate): Promise<{ updated_count: number }> {
    const response = await api.patch<{ updated_count: number }>(`/events/${eventId}/update-future`, data);
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
   * Cancel all events in a recurring series
   */
  async cancelEventSeries(parentEventId: string, cancelData: EventCancel, cancelFutureOnly = false): Promise<{ message: string; cancelled_count: number }> {
    const response = await api.post<{ message: string; cancelled_count: number }>(
      `/events/${parentEventId}/cancel-series?cancel_future_only=${cancelFutureOnly}`,
      cancelData
    );
    return response.data;
  },

  /**
   * Create or update an RSVP. When offline the request is enqueued and
   * resolved with an optimistic placeholder; the sync engine flushes
   * it when connectivity returns.
   */
  async createOrUpdateRSVP(eventId: string, rsvpData: RSVPCreate): Promise<RSVP> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      await enqueueGeneric(
        'event-rsvp',
        `/events/${eventId}/rsvp`,
        rsvpData,
        `RSVP: ${rsvpData.status}`,
      );
      void usePendingSyncStore.getState().refresh();
      return {
        id: 'pending-sync',
        event_id: eventId,
        user_id: '',
        status: rsvpData.status,
        guest_count: rsvpData.guest_count ?? 0,
        responded_at: new Date().toISOString(),
        checked_in: false,
        offline_pending: true,
      } as unknown as RSVP;
    }
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
   * Finalize attendance duration for all checked-in members who didn't check out.
   * Uses actual_end_time (if recorded) or end_datetime minus check-in time.
   */
  async finalizeAttendance(eventId: string): Promise<{ updated_count: number }> {
    const response = await api.post<{ updated_count: number }>(`/events/${eventId}/finalize-attendance`);
    return response.data;
  },

  async endEvent(eventId: string): Promise<{ checked_out_count: number; actual_end_time: string }> {
    const response = await api.post<{ checked_out_count: number; actual_end_time: string }>(`/events/${eventId}/end-event`);
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
   * Bulk-add multiple attendees to an event (manager action)
   */
  async bulkAddAttendees(eventId: string, userIds: string[], status?: string): Promise<{ created_count: number; errors: Array<{ user_id: string; error: string }> }> {
    const response = await api.post<{ created_count: number; errors: Array<{ user_id: string; error: string }> }>(
      `/events/${eventId}/bulk-add-attendees`,
      { user_ids: userIds, status: status || 'going' }
    );
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

  // Event Attachments
  async getAttachments(eventId: string): Promise<import('../types/event').EventAttachment[]> {
    const response = await api.get<import('../types/event').EventAttachment[]>(`/events/${eventId}/attachments`);
    return response.data;
  },

  async uploadAttachment(eventId: string, file: File, description?: string): Promise<import('../types/event').EventAttachmentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (description) formData.append('description', description);
    const response = await api.post<import('../types/event').EventAttachmentUploadResponse>(`/events/${eventId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteAttachment(eventId: string, attachmentId: string): Promise<void> {
    await api.delete(`/events/${eventId}/attachments/${attachmentId}`);
  },

  getAttachmentDownloadUrl(eventId: string, attachmentId: string): string {
    return `/api/v1/events/${eventId}/attachments/${attachmentId}/download`;
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

  /**
   * RSVP to all future events in a recurring series
   */
  async rsvpToSeries(parentEventId: string, rsvpData: RSVPCreate): Promise<{ message: string; rsvp_count: number }> {
    const response = await api.post<{ message: string; rsvp_count: number }>(`/events/${parentEventId}/rsvp-series`, rsvpData);
    return response.data;
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

  /**
   * Send reminders for an event (non-respondents or all members)
   */
  async sendReminders(
    eventId: string,
    reminderType: 'non_respondents' | 'all',
  ): Promise<{ message: string; sent_count: number }> {
    const response = await api.post<{ message: string; sent_count: number }>(
      `/events/${eventId}/send-reminders`,
      { reminder_type: reminderType },
    );
    return response.data;
  },

  /**
   * Send a notification about an event (announcement, reminder, follow-up, etc.)
   */
  async sendEventNotification(
    eventId: string,
    data: {
      notification_type: 'announcement' | 'reminder' | 'follow_up' | 'missed_event' | 'check_in_confirmation';
      message?: string | undefined;
      target?: 'all' | 'going' | 'not_responded' | 'checked_in' | 'not_checked_in' | undefined;
    },
  ): Promise<{ message: string; recipients_count: number }> {
    const response = await api.post<{ message: string; recipients_count: number }>(
      `/events/${eventId}/notify`,
      data,
    );
    return response.data;
  },

  /**
   * Get RSVP change history for an event (admin only)
   */
  async getRSVPHistory(eventId: string, limit?: number): Promise<import('../types/event').RSVPHistory[]> {
    const params = limit ? { limit } : undefined;
    const response = await api.get<import('../types/event').RSVPHistory[]>(`/events/${eventId}/rsvp-history`, { params });
    return response.data;
  },

  /**
   * Import events from a CSV file
   */
  async importEventsCSV(file: File): Promise<CSVImportResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<CSVImportResponse>('/events/import-csv', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  /**
   * Get analytics summary for attendance trends dashboard (#44, #46, #47)
   */
  async getAnalyticsSummary(params?: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await api.get<Record<string, unknown>>('/events/analytics/summary', { params });
    return response.data;
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
  category_name?: string;
  name: string;
  description?: string;
  manufacturer?: string;
  model_number?: string;
  serial_number?: string;
  asset_tag?: string;
  barcode?: string;
  purchase_date?: string;
  purchase_price?: number;
  current_value?: number;
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
  reorder_point?: number;
  last_inspection_date?: string;
  next_inspection_due?: string;
  inspection_interval_days?: number;
  assigned_to_user_id?: string;
  assigned_date?: string;
  min_rank_order?: number | null;
  restricted_to_positions?: string[] | null;
  notes?: string;
  standard_size?: string;
  style?: string;
  variant_group_id?: string;
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
  reorder_point?: number | undefined;
  inspection_interval_days?: number | undefined;
  min_rank_order?: number | null | undefined;
  restricted_to_positions?: string[] | null | undefined;
  notes?: string | undefined;
  standard_size?: string | undefined;
  style?: string | undefined;
  variant_group_id?: string | undefined;
}

export interface ItemVariantGroup {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  category_id?: string;
  base_price?: number;
  base_replacement_cost?: number;
  unit_of_measure?: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  items?: InventoryItem[];
}

export interface ItemVariantGroupCreate {
  name: string;
  description?: string | undefined;
  category_id?: string | undefined;
  base_price?: number | undefined;
  base_replacement_cost?: number | undefined;
  unit_of_measure?: string | undefined;
}

export interface EquipmentKit {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  restricted_to_roles?: string[];
  min_rank_order?: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  line_items?: EquipmentKitItem[];
}

export interface EquipmentKitItem {
  id: string;
  kit_id: string;
  item_id?: string;
  category_id?: string;
  item_name: string;
  quantity: number;
  size_selectable: boolean;
  sort_order: number;
}

export interface EquipmentKitCreate {
  name: string;
  description?: string | undefined;
  restricted_to_roles?: string[] | undefined;
  min_rank_order?: number | undefined;
  line_items: Array<{
    item_id?: string | undefined;
    category_id?: string | undefined;
    item_name: string;
    quantity?: number | undefined;
    size_selectable?: boolean | undefined;
  }>;
}

export interface MemberSizePreferences {
  id: string;
  organization_id: string;
  user_id: string;
  shirt_size?: string;
  shirt_style?: string;
  pant_waist?: string;
  pant_inseam?: string;
  jacket_size?: string;
  boot_size?: string;
  boot_width?: string;
  glove_size?: string;
  hat_size?: string;
  custom_sizes?: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface MemberSizePreferencesCreate {
  shirt_size?: string | undefined;
  shirt_style?: string | undefined;
  pant_waist?: string | undefined;
  pant_inseam?: string | undefined;
  jacket_size?: string | undefined;
  boot_size?: string | undefined;
  boot_width?: string | undefined;
  glove_size?: string | undefined;
  hat_size?: string | undefined;
  custom_sizes?: Record<string, string> | undefined;
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
  styles?: string[] | undefined;
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
  create_variant_group?: boolean | undefined;
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

export interface LocationInventorySummary {
  location_id: string | null;
  location_name: string;
  item_count: number;
  total_quantity: number;
  total_value: number;
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

// Reorder Request Types
export interface ReorderRequest {
  id: string;
  organization_id: string;
  item_id?: string;
  category_id?: string;
  item_name: string;
  quantity_requested: number;
  quantity_received?: number;
  vendor?: string;
  vendor_contact?: string;
  estimated_unit_cost?: number;
  actual_unit_cost?: number;
  purchase_order_number?: string;
  expected_delivery_date?: string;
  status: string;
  urgency: string;
  notes?: string;
  requested_by?: string;
  requester_name?: string;
  approved_by?: string;
  approver_name?: string;
  approved_at?: string;
  ordered_at?: string;
  received_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ReorderRequestCreate {
  item_id?: string | undefined;
  category_id?: string | undefined;
  item_name: string;
  quantity_requested: number;
  vendor?: string | undefined;
  vendor_contact?: string | undefined;
  estimated_unit_cost?: number | undefined;
  expected_delivery_date?: string | undefined;
  urgency?: string | undefined;
  notes?: string | undefined;
}

export interface ReorderRequestUpdate {
  item_name?: string | undefined;
  quantity_requested?: number | undefined;
  quantity_received?: number | undefined;
  vendor?: string | undefined;
  vendor_contact?: string | undefined;
  estimated_unit_cost?: number | undefined;
  actual_unit_cost?: number | undefined;
  purchase_order_number?: string | undefined;
  expected_delivery_date?: string | undefined;
  status?: string | undefined;
  urgency?: string | undefined;
  notes?: string | undefined;
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
  auto_rotate?: boolean;
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

// ============================================
// Charge Management Types
// ============================================

export interface IssuanceChargeListItem {
  issuance_id: string;
  item_id: string;
  item_name: string;
  user_id: string;
  user_name: string;
  quantity_issued: number;
  issued_at: string;
  returned_at?: string;
  is_returned: boolean;
  return_condition?: string;
  unit_cost_at_issuance?: number;
  charge_status: string;
  charge_amount?: number;
}

export interface ChargeManagementResponse {
  items: IssuanceChargeListItem[];
  total: number;
  total_pending: number;
  total_charged: number;
  total_waived: number;
}

// ============================================
// Return Request Types
// ============================================

export interface ReturnRequestItem {
  id: string;
  organization_id: string;
  requester_id: string;
  requester_name?: string;
  return_type: 'assignment' | 'issuance' | 'checkout';
  item_id: string;
  item_name: string;
  assignment_id?: string;
  issuance_id?: string;
  checkout_id?: string;
  quantity_returning: number;
  reported_condition: string;
  member_notes?: string;
  status: 'pending' | 'approved' | 'denied' | 'completed';
  reviewed_by?: string;
  reviewer_name?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
}
