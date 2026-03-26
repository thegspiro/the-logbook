/**
 * adminServices — extracted from services/api.ts
 */

import api from './apiClient';
import type { SecurityStatus, SecurityAlert } from './facilitiesServices';
import type { DashboardStats, AdminSummary, ActionItemSummary, CommunityEngagement } from './communicationsServices';
import type { IntegrationConfig } from './trainingServices';
import type { LeaveOfAbsenceResponse, TrainingWaiverResponse } from './facilitiesServices';
import type { PlatformAnalytics } from '../types/platformAnalytics';

export const securityService = {
  async getStatus(): Promise<SecurityStatus> {
    const response = await api.get<SecurityStatus>('/security/status');
    return response.data;
  },

  async getAlerts(params?: { limit?: number; threat_level?: string; alert_type?: string }): Promise<{ alerts: SecurityAlert[]; total: number }> {
    const response = await api.get<{ alerts: SecurityAlert[]; total: number }>('/security/alerts', { params });
    return response.data;
  },

  async acknowledgeAlert(alertId: string): Promise<{ status: string; alert_id: string }> {
    const response = await api.post<{ status: string; alert_id: string }>(`/security/alerts/${alertId}/acknowledge`);
    return response.data;
  },

  async verifyAuditIntegrity(params?: { start_id?: number; end_id?: number }): Promise<{ verified: boolean; total_checked: number; errors: string[] }> {
    const response = await api.get<{ verified: boolean; total_checked: number; errors: string[] }>('/security/audit-log/integrity', { params });
    return response.data;
  },

  async triggerManualCheck(): Promise<{ check_completed: boolean; overall_status: string; integrity: Record<string, unknown> }> {
    const response = await api.post<{ check_completed: boolean; overall_status: string; integrity: Record<string, unknown> }>('/security/manual-check');
    return response.data;
  },
};

// ============================================
// Training Sessions Service
// ============================================

export interface TrainingSessionResponse {
  id: string;
  organization_id: string;
  event_id: string;
  course_id?: string;
  category_id?: string;
  program_id?: string;
  phase_id?: string;
  requirement_id?: string;
  course_name: string;
  course_code?: string;
  training_type: string;
  credit_hours: number;
  instructor?: string;
  issues_certification: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;
  auto_create_records: boolean;
  require_completion_confirmation: boolean;
  approval_required: boolean;
  approval_deadline_days: number;
  is_finalized: boolean;
  finalized_at?: string;
  finalized_by?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface TrainingSessionCreate {
  title: string;
  description?: string | undefined;
  location_id?: string | undefined;
  location?: string | undefined;
  location_details?: string | undefined;
  start_datetime: string;
  end_datetime: string;
  requires_rsvp?: boolean | undefined;
  rsvp_deadline?: string | undefined;
  max_attendees?: number | undefined;
  is_mandatory?: boolean | undefined;
  check_in_window_type?: string | undefined;
  check_in_minutes_before?: number | undefined;
  check_in_minutes_after?: number | undefined;
  require_checkout?: boolean | undefined;
  use_existing_course?: boolean | undefined;
  course_id?: string | undefined;
  category_id?: string | undefined;
  program_id?: string | undefined;
  phase_id?: string | undefined;
  requirement_id?: string | undefined;
  course_name?: string | undefined;
  course_code?: string | undefined;
  training_type: string;
  credit_hours: number;
  instructor?: string | undefined;
  issues_certification?: boolean | undefined;
  certification_number_prefix?: string | undefined;
  issuing_agency?: string | undefined;
  expiration_months?: number | undefined;
  auto_create_records?: boolean | undefined;
  require_completion_confirmation?: boolean | undefined;
  approval_required?: boolean | undefined;
  approval_deadline_days?: number | undefined;
}

export interface RecurringTrainingSessionCreate extends TrainingSessionCreate {
  recurrence_pattern: string;
  recurrence_end_date: string;
  recurrence_custom_days?: number[] | undefined;
  recurrence_weekday?: number | undefined;
  recurrence_week_ordinal?: number | undefined;
  recurrence_month?: number | undefined;
  recurrence_exceptions?: string[] | undefined;
}

export const analyticsApiService = {
  async trackEvent(data: { event_type: string; event_id: string; user_id?: string | undefined; metadata: Record<string, unknown> }): Promise<void> {
    await api.post('/analytics/track', data);
  },

  async getMetrics(eventId?: string): Promise<AnalyticsMetrics> {
    const response = await api.get<AnalyticsMetrics>('/analytics/metrics', {
      params: eventId ? { event_id: eventId } : undefined,
    });
    return response.data;
  },

  async exportAnalytics(eventId?: string): Promise<string> {
    const response = await api.get('/analytics/export', {
      params: eventId ? { event_id: eventId } : undefined,
    });
    return JSON.stringify(response.data, null, 2);
  },
};

// ============================================
// Error Logs Service (backend-persisted)
// ============================================

export interface ErrorLogRecord {
  id: string;
  error_type: string;
  error_message: string;
  user_message: string;
  troubleshooting_steps: string[];
  context: Record<string, unknown>;
  user_id?: string;
  event_id?: string;
  created_at: string;
}

export interface ErrorLogStats {
  total: number;
  by_type: Record<string, number>;
  recent_errors: ErrorLogRecord[];
}

export const errorLogsService = {
  async logError(data: {
    error_type: string;
    error_message: string;
    user_message: string;
    context: Record<string, unknown>;
    event_id?: string | undefined;
  }): Promise<void> {
    await api.post('/errors/log', data);
  },

  async getErrors(params?: { error_type?: string; event_id?: string; skip?: number; limit?: number }): Promise<{ errors: ErrorLogRecord[]; total: number }> {
    const response = await api.get<{ errors: ErrorLogRecord[]; total: number }>('/errors', { params });
    return response.data;
  },

  async getStats(): Promise<ErrorLogStats> {
    const response = await api.get<ErrorLogStats>('/errors/stats');
    return response.data;
  },

  async clearErrors(): Promise<void> {
    await api.delete('/errors');
  },

  async exportErrors(params?: { event_id?: string }): Promise<string> {
    const response = await api.get('/errors/export', { params });
    return JSON.stringify(response.data, null, 2);
  },
};

// ============================================
// Facilities Service
// ============================================

export const platformAnalyticsService = {
  /**
   * Get aggregated platform-wide analytics for IT admins.
   */
  async getAnalytics(): Promise<PlatformAnalytics> {
    const response = await api.get<PlatformAnalytics>('/platform-analytics');
    return response.data;
  },

  /**
   * Export platform analytics as a JSON blob.
   */
  async exportAnalytics(): Promise<PlatformAnalytics> {
    const data = await this.getAnalytics();
    return data;
  },
};

export const dashboardService = {
  async getStats(): Promise<DashboardStats> {
    const response = await api.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },
  async getAdminSummary(): Promise<AdminSummary> {
    const response = await api.get<AdminSummary>('/dashboard/admin-summary');
    return response.data;
  },
  async getActionItems(params?: { status_filter?: string | undefined; assigned_to_me?: boolean | undefined }): Promise<ActionItemSummary[]> {
    const response = await api.get<ActionItemSummary[]>('/dashboard/action-items', { params });
    return response.data;
  },
  async getCommunityEngagement(): Promise<CommunityEngagement> {
    const response = await api.get<CommunityEngagement>('/dashboard/community-engagement');
    return response.data;
  },
  async getBranding(): Promise<{ name?: string }> {
    const response = await api.get<{ name?: string }>('/auth/branding');
    return response.data;
  },
};

// ============================================
// Email Templates Service
// ============================================

export interface TemplateVariable {
  name: string;
  description: string;
}

export interface EmailTemplate {
  id: string;
  organization_id: string;
  template_type: string;
  name: string;
  description?: string;
  subject: string;
  html_body: string;
  text_body?: string;
  css_styles?: string;
  allow_attachments: boolean;
  is_active: boolean;
  default_cc?: string[];
  default_bcc?: string[];
  available_variables: TemplateVariable[];
  created_at: string;
  updated_at: string;
  attachments: EmailAttachment[];
}

export interface EmailAttachment {
  id: string;
  template_id: string;
  filename: string;
  content_type: string;
  file_size: string;
  created_at: string;
}

export interface EmailTemplateUpdate {
  name?: string;
  subject?: string;
  html_body?: string;
  text_body?: string;
  css_styles?: string;
  description?: string;
  is_active?: boolean;
  allow_attachments?: boolean;
  default_cc?: string[] | null;
  default_bcc?: string[] | null;
}

export interface EmailTemplatePreview {
  subject: string;
  html_body: string;
  text_body: string;
}

export const reportsService = {
  async getAvailableReports(): Promise<{ available_reports: Array<{ id: string; title: string; description: string; category: string; available: boolean }> }> {
    const response = await api.get<{ available_reports: Array<{ id: string; title: string; description: string; category: string; available: boolean }> }>('/reports/available');
    return response.data;
  },

  async generateReport(data: { report_type: string; start_date?: string; end_date?: string; filters?: Record<string, unknown> }): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/reports/generate', data);
    return response.data;
  },
};

// ============================================
// Notifications Service
// ============================================

export interface NotificationRuleRecord {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  trigger: string;
  category: string;
  channel: string;
  enabled: boolean;
  config?: unknown;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

export interface NotificationLogRecord {
  id: string;
  organization_id: string;
  rule_id?: string;
  rule_name?: string;
  recipient_id?: string;
  recipient_email?: string;
  recipient_name?: string;
  channel: string;
  category?: string;
  subject?: string;
  message?: string;
  sent_at: string;
  delivered: boolean;
  read: boolean;
  read_at?: string;
  pinned: boolean;
  error?: string;
  action_url?: string;
  metadata?: Record<string, unknown>;
  expires_at?: string;
  created_at: string;
}

export interface NotificationsSummary {
  total_rules: number;
  active_rules: number;
  emails_sent_this_month: number;
  notifications_sent_this_month: number;
}

export const memberStatusService = {
  async changeStatus(userId: string, data: import('../types/user').MemberStatusChangeRequest): Promise<import('../types/user').MemberStatusChangeResponse> {
    const response = await api.patch<import('../types/user').MemberStatusChangeResponse>(`/users/${userId}/status`, data);
    return response.data;
  },

  async getArchivedMembers(): Promise<{ members: import('../types/user').ArchivedMember[] }> {
    const response = await api.get<{ members: import('../types/user').ArchivedMember[] }>('/users/archived');
    return response.data;
  },

  async reactivateMember(userId: string, data: { reason: string }): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>(`/users/${userId}/reactivate`, data);
    return response.data;
  },

  async getOverduePropertyReturns(): Promise<{ members: import('../types/user').OverdueMember[] }> {
    const response = await api.get<{ members: import('../types/user').OverdueMember[] }>('/users/property-return-reminders/overdue');
    return response.data;
  },

  async processPropertyReturnReminders(): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/users/property-return-reminders/process');
    return response.data;
  },

  async getPropertyReturnPreview(userId: string): Promise<import('../types/user').PropertyReturnReport> {
    const response = await api.get<import('../types/user').PropertyReturnReport>(`/users/${userId}/property-return-report`);
    return response.data;
  },

  async getTierConfig(): Promise<import('../types/user').MembershipTierConfig> {
    const response = await api.get<import('../types/user').MembershipTierConfig>('/users/membership-tiers/config');
    return response.data;
  },

  async updateTierConfig(config: import('../types/user').MembershipTierConfig): Promise<import('../types/user').MembershipTierConfig> {
    const response = await api.put<import('../types/user').MembershipTierConfig>('/users/membership-tiers/config', config);
    return response.data;
  },

  async advanceMembershipTiers(): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/users/advance-membership-tiers');
    return response.data;
  },

  // Leave of Absence
  async listLeavesOfAbsence(params?: { user_id?: string; active_only?: boolean }): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>('/users/leaves-of-absence', { params });
    return response.data;
  },

  async getMemberLeaves(userId: string, activeOnly = true): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>(`/users/${userId}/leaves-of-absence`, { params: { active_only: activeOnly } });
    return response.data;
  },

  async getMyLeaves(): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>('/users/leaves-of-absence/me');
    return response.data;
  },

  async createLeaveOfAbsence(data: {
    user_id: string;
    leave_type: string;
    reason?: string | undefined;
    start_date: string;
    end_date?: string | undefined;
    exempt_from_training_waiver?: boolean;
  }): Promise<LeaveOfAbsenceResponse> {
    const response = await api.post<LeaveOfAbsenceResponse>('/users/leaves-of-absence', data);
    return response.data;
  },

  async updateLeaveOfAbsence(leaveId: string, data: {
    leave_type?: string;
    reason?: string;
    start_date?: string;
    end_date?: string;
    active?: boolean;
    exempt_from_training_waiver?: boolean;
  }): Promise<LeaveOfAbsenceResponse> {
    const response = await api.patch<LeaveOfAbsenceResponse>(`/users/leaves-of-absence/${leaveId}`, data);
    return response.data;
  },

  async deleteLeaveOfAbsence(leaveId: string): Promise<void> {
    await api.delete(`/users/leaves-of-absence/${leaveId}`);
  },

  // Training Waivers
  async listTrainingWaivers(params?: { user_id?: string; active_only?: boolean }): Promise<TrainingWaiverResponse[]> {
    const response = await api.get<TrainingWaiverResponse[]>('/training/waivers', { params });
    return response.data;
  },

  async createTrainingWaiver(data: {
    user_id: string;
    waiver_type: string;
    reason?: string | undefined;
    start_date: string;
    end_date?: string | undefined;
    requirement_ids?: string[];
  }): Promise<TrainingWaiverResponse> {
    const response = await api.post<TrainingWaiverResponse>('/training/waivers', data);
    return response.data;
  },

  async updateTrainingWaiver(waiverId: string, data: {
    waiver_type?: string;
    reason?: string;
    start_date?: string;
    end_date?: string;
    requirement_ids?: string[];
    active?: boolean;
  }): Promise<TrainingWaiverResponse> {
    const response = await api.patch<TrainingWaiverResponse>(`/training/waivers/${waiverId}`, data);
    return response.data;
  },

  async deleteTrainingWaiver(waiverId: string): Promise<void> {
    await api.delete(`/training/waivers/${waiverId}`);
  },
};

// ============================================
// Department Messages Service
// ============================================

export interface DepartmentMessageRecord {
  id: string;
  organization_id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  target_type: 'all' | 'roles' | 'statuses' | 'members';
  target_roles?: string[];
  target_statuses?: string[];
  target_member_ids?: string[];
  is_pinned: boolean;
  is_active: boolean;
  is_persistent: boolean;
  requires_acknowledgment: boolean;
  posted_by?: string;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface InboxMessage {
  id: string;
  title: string;
  body: string;
  priority: 'normal' | 'important' | 'urgent';
  target_type: string;
  is_pinned: boolean;
  is_persistent: boolean;
  requires_acknowledgment: boolean;
  posted_by?: string;
  author_name?: string;
  created_at?: string;
  expires_at?: string;
  is_read: boolean;
  read_at?: string;
  is_acknowledged: boolean;
  acknowledged_at?: string;
}

export interface MessageStats {
  message_id: string;
  total_reads: number;
  total_acknowledged: number;
}

export interface RoleOption {
  name: string;
  slug: string;
}

export const shiftCompletionService = {
  async createReport(data: import('../types/training').ShiftCompletionReportCreate): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>('/training/shift-reports', data);
    return response.data;
  },

  async getMyReports(params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>('/training/shift-reports/my-reports', { params });
    return response.data;
  },

  async getMyStats(params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get<import('../types/training').TraineeShiftStats>('/training/shift-reports/my-stats', { params });
    return response.data;
  },

  async getReportsByOfficer(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>('/training/shift-reports/by-officer');
    return response.data;
  },

  async getReportsForTrainee(traineeId: string, params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(`/training/shift-reports/trainee/${traineeId}`, { params });
    return response.data;
  },

  async getTraineeStats(traineeId: string, params?: { start_date?: string; end_date?: string }): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get<import('../types/training').TraineeShiftStats>(`/training/shift-reports/trainee/${traineeId}/stats`, { params });
    return response.data;
  },

  async getAllReports(params?: { trainee_id?: string; officer_id?: string; start_date?: string; end_date?: string; limit?: number; offset?: number }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>('/training/shift-reports/all', { params });
    return response.data;
  },

  async getReport(reportId: string): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.get<import('../types/training').ShiftCompletionReport>(`/training/shift-reports/${reportId}`);
    return response.data;
  },

  async acknowledgeReport(reportId: string, comments?: string): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>(`/training/shift-reports/${reportId}/acknowledge`, { trainee_comments: comments });
    return response.data;
  },

  async getPendingReviewReports(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>('/training/shift-reports/pending-review');
    return response.data;
  },

  async reviewReport(reportId: string, data: { review_status: string; reviewer_notes?: string | undefined; redact_fields?: string[] | undefined }): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>(`/training/shift-reports/${reportId}/review`, data);
    return response.data;
  },
};

// ============================================
// Training Module Config Service
// ============================================

export interface TestConnectionResult {
  success: boolean;
  message: string;
}

export const integrationsService = {
  async getIntegrations(): Promise<IntegrationConfig[]> {
    const response = await api.get<IntegrationConfig[]>('/integrations');
    return response.data;
  },

  async getIntegration(integrationId: string): Promise<IntegrationConfig> {
    const response = await api.get<IntegrationConfig>(`/integrations/${integrationId}`);
    return response.data;
  },

  async connectIntegration(integrationId: string, config: Record<string, unknown>): Promise<IntegrationConfig> {
    const response = await api.post<IntegrationConfig>(`/integrations/${integrationId}/connect`, { config });
    return response.data;
  },

  async disconnectIntegration(integrationId: string): Promise<void> {
    await api.post(`/integrations/${integrationId}/disconnect`);
  },

  async updateIntegration(integrationId: string, config: Record<string, unknown>): Promise<IntegrationConfig> {
    const response = await api.patch<IntegrationConfig>(`/integrations/${integrationId}`, { config });
    return response.data;
  },

  async testConnection(integrationId: string): Promise<TestConnectionResult> {
    const response = await api.post<TestConnectionResult>(`/integrations/${integrationId}/test-connection`);
    return response.data;
  },
};

// ============================================
// Analytics API Service (backend-persisted)
// ============================================

export interface AnalyticsEventRecord {
  id: string;
  event_type: string;
  event_id: string;
  user_id?: string;
  metadata: Record<string, unknown>;
  device_type: string;
  created_at: string;
}

export interface AnalyticsMetrics {
  total_scans: number;
  successful_check_ins: number;
  failed_check_ins: number;
  success_rate: number;
  avg_time_to_check_in: number;
  device_breakdown: Record<string, number>;
  error_breakdown: Record<string, number>;
  hourly_activity: Array<{ hour: number; count: number }>;
}
