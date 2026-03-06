/**
 * communicationsServices — extracted from services/api.ts
 */

import api from './apiClient';
import type {
  NotificationRuleRecord, NotificationLogRecord, NotificationsSummary,
  DepartmentMessageRecord, InboxMessage, MessageStats, RoleOption,
  EmailTemplate, EmailAttachment, EmailTemplateUpdate, EmailTemplatePreview,
} from './adminServices';

export const notificationsService = {
  async getRules(params?: { category?: string; enabled?: boolean; search?: string }): Promise<{ rules: NotificationRuleRecord[]; total: number }> {
    const response = await api.get<{ rules: NotificationRuleRecord[]; total: number }>('/notifications/rules', { params });
    return response.data;
  },

  async createRule(data: Record<string, unknown>): Promise<NotificationRuleRecord> {
    const response = await api.post<NotificationRuleRecord>('/notifications/rules', data);
    return response.data;
  },

  async getRule(ruleId: string): Promise<NotificationRuleRecord> {
    const response = await api.get<NotificationRuleRecord>(`/notifications/rules/${ruleId}`);
    return response.data;
  },

  async updateRule(ruleId: string, data: Record<string, unknown>): Promise<NotificationRuleRecord> {
    const response = await api.patch<NotificationRuleRecord>(`/notifications/rules/${ruleId}`, data);
    return response.data;
  },

  async deleteRule(ruleId: string): Promise<void> {
    await api.delete(`/notifications/rules/${ruleId}`);
  },

  async toggleRule(ruleId: string, enabled: boolean): Promise<NotificationRuleRecord> {
    const response = await api.post<NotificationRuleRecord>(`/notifications/rules/${ruleId}/toggle`, null, { params: { enabled } });
    return response.data;
  },

  async getLogs(params?: { channel?: string; skip?: number; limit?: number }): Promise<{ logs: NotificationLogRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ logs: NotificationLogRecord[]; total: number; skip: number; limit: number }>('/notifications/logs', { params });
    return response.data;
  },

  async markAsRead(logId: string): Promise<NotificationLogRecord> {
    const response = await api.post<NotificationLogRecord>(`/notifications/logs/${logId}/read`);
    return response.data;
  },

  async getSummary(): Promise<NotificationsSummary> {
    const response = await api.get<NotificationsSummary>('/notifications/summary');
    return response.data;
  },

  // User-facing notification inbox
  async getMyNotifications(params?: { include_expired?: boolean; include_read?: boolean; skip?: number; limit?: number }): Promise<{ logs: NotificationLogRecord[]; total: number; skip: number; limit: number }> {
    const response = await api.get<{ logs: NotificationLogRecord[]; total: number; skip: number; limit: number }>('/notifications/my', { params });
    return response.data;
  },

  async getMyUnreadCount(): Promise<{ unread_count: number }> {
    const response = await api.get<{ unread_count: number }>('/notifications/my/unread-count');
    return response.data;
  },

  async markMyNotificationRead(logId: string): Promise<NotificationLogRecord> {
    const response = await api.post<NotificationLogRecord>(`/notifications/my/${logId}/read`);
    return response.data;
  },
};

export interface DashboardStats {
  total_members: number;
  active_members: number;
  total_documents: number;
  setup_percentage: number;
  recent_events_count: number;
  pending_tasks_count: number;
}

export interface AdminSummary {
  active_members: number;
  inactive_members: number;
  total_members: number;
  training_completion_pct: number;
  upcoming_events_count: number;
  overdue_action_items: number;
  open_action_items: number;
  recent_training_hours: number;
  recent_admin_hours: number;
  pending_admin_hours_approvals: number;
}

export interface ActionItemSummary {
  id: string;
  source: string;
  source_id: string;
  description: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  status: string;
  priority?: string;
  created_at: string;
}

export interface CommunityEngagement {
  total_public_events: number;
  total_member_attendees: number;
  total_external_attendees: number;
  upcoming_public_events: number;
}

export interface ComplianceMatrixMember {
  user_id: string;
  member_name: string;
  requirements: Array<{
    requirement_id: string;
    requirement_name: string;
    status: string;
    completion_date?: string;
    expiry_date?: string;
  }>;
  completion_pct: number;
}

export interface ComplianceMatrix {
  members: ComplianceMatrixMember[];
  requirements: Array<{ id: string; name: string; recurrence_months?: number }>;
  generated_at: string;
}

export interface ExpiringCertification {
  user_id: string;
  member_name: string;
  requirement_id: string;
  requirement_name: string;
  expiry_date: string;
  days_until_expiry: number;
  status: string;
}

export const emailTemplatesService = {
  async getTemplates(): Promise<EmailTemplate[]> {
    const response = await api.get<EmailTemplate[]>('/email-templates');
    return response.data;
  },

  async getTemplate(templateId: string): Promise<EmailTemplate> {
    const response = await api.get<EmailTemplate>(`/email-templates/${templateId}`);
    return response.data;
  },

  async updateTemplate(templateId: string, data: EmailTemplateUpdate): Promise<EmailTemplate> {
    const response = await api.put<EmailTemplate>(`/email-templates/${templateId}`, data);
    return response.data;
  },

  async previewTemplate(templateId: string, context?: Record<string, unknown>, overrides?: { subject?: string; html_body?: string; css_styles?: string }, memberId?: string): Promise<EmailTemplatePreview> {
    const response = await api.post<EmailTemplatePreview>(`/email-templates/${templateId}/preview`, {
      context: context || {},
      ...overrides,
      ...(memberId ? { member_id: memberId } : {}),
    });
    return response.data;
  },

  async uploadAttachment(templateId: string, file: File): Promise<EmailAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await api.post<EmailAttachment>(`/email-templates/${templateId}/attachments`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteAttachment(templateId: string, attachmentId: string): Promise<void> {
    await api.delete(`/email-templates/${templateId}/attachments/${attachmentId}`);
  },
};

// ============================================
// Scheduled Emails
// ============================================

export interface ScheduledEmail {
  id: string;
  organization_id: string;
  template_id?: string;
  template_type: string;
  to_emails: string[];
  cc_emails?: string[];
  bcc_emails?: string[];
  context: Record<string, unknown>;
  scheduled_at: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  sent_at?: string;
  error_message?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduledEmailCreate {
  template_type: string;
  template_id?: string | undefined;
  to_emails: string[];
  cc_emails?: string[] | undefined;
  bcc_emails?: string[] | undefined;
  context: Record<string, unknown>;
  scheduled_at: string;
}

export interface ScheduledEmailUpdate {
  scheduled_at?: string;
  status?: 'cancelled';
}

export const scheduledEmailsService = {
  async create(data: ScheduledEmailCreate): Promise<ScheduledEmail> {
    const response = await api.post<ScheduledEmail>('/email-templates/schedule', data);
    return response.data;
  },

  async list(statusFilter?: string): Promise<ScheduledEmail[]> {
    const params = statusFilter ? { status_filter: statusFilter } : {};
    const response = await api.get<ScheduledEmail[]>('/email-templates/scheduled', { params });
    return response.data;
  },

  async update(id: string, data: ScheduledEmailUpdate): Promise<ScheduledEmail> {
    const response = await api.patch<ScheduledEmail>(`/email-templates/scheduled/${id}`, data);
    return response.data;
  },

  async cancel(id: string): Promise<void> {
    await api.delete(`/email-templates/scheduled/${id}`);
  },
};

// ============================================
// Locations Service
// ============================================

export interface Location {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
  building?: string;
  floor?: string;
  room_number?: string;
  capacity?: number;
  facility_id?: string;
  facility_room_id?: string;
  display_code?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LocationCreate {
  name: string;
  description?: string | undefined;
  address?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
  zip?: string | undefined;
  latitude?: string | undefined;
  longitude?: string | undefined;
  building?: string | undefined;
  floor?: string | undefined;
  room_number?: string | undefined;
  capacity?: number | undefined;
}

export const messagesService = {
  // Admin CRUD
  async getMessages(params?: { include_inactive?: boolean; skip?: number; limit?: number }): Promise<{ messages: DepartmentMessageRecord[]; total: number }> {
    const response = await api.get<{ messages: DepartmentMessageRecord[]; total: number }>('/messages', { params });
    return response.data;
  },
  async createMessage(data: {
    title: string;
    body: string;
    priority?: string;
    target_type?: string;
    target_roles?: string[];
    target_statuses?: string[];
    target_member_ids?: string[];
    is_pinned?: boolean;
    requires_acknowledgment?: boolean;
    expires_at?: string;
  }): Promise<DepartmentMessageRecord> {
    const response = await api.post<DepartmentMessageRecord>('/messages', data);
    return response.data;
  },
  async getMessage(messageId: string): Promise<DepartmentMessageRecord> {
    const response = await api.get<DepartmentMessageRecord>(`/messages/${messageId}`);
    return response.data;
  },
  async updateMessage(messageId: string, data: Record<string, unknown>): Promise<DepartmentMessageRecord> {
    const response = await api.patch<DepartmentMessageRecord>(`/messages/${messageId}`, data);
    return response.data;
  },
  async deleteMessage(messageId: string): Promise<void> {
    await api.delete(`/messages/${messageId}`);
  },
  async getAvailableRoles(): Promise<RoleOption[]> {
    const response = await api.get<RoleOption[]>('/messages/roles');
    return response.data;
  },
  async getMessageStats(messageId: string): Promise<MessageStats> {
    const response = await api.get<MessageStats>(`/messages/${messageId}/stats`);
    return response.data;
  },

  // Member inbox
  async getInbox(params?: { include_read?: boolean; skip?: number; limit?: number }): Promise<InboxMessage[]> {
    const response = await api.get<InboxMessage[]>('/messages/inbox', { params });
    return response.data;
  },
  async getUnreadCount(): Promise<{ unread_count: number }> {
    const response = await api.get<{ unread_count: number }>('/messages/inbox/unread-count');
    return response.data;
  },
  async markAsRead(messageId: string): Promise<void> {
    await api.post(`/messages/${messageId}/read`);
  },
  async acknowledge(messageId: string): Promise<void> {
    await api.post(`/messages/${messageId}/acknowledge`);
  },
};

// ==================== Skills Testing Service ====================
