/**
 * adminServices — extracted from services/api.ts
 */

import api from './apiClient';
import { dedupeInFlight } from '../utils/inFlight';
import type { SecurityStatus, SecurityAlert } from './facilitiesServices';
import type {
  DashboardStats,
  AdminSummary,
  OperationsDashboard,
  ActionItemSummary,
  CommunityEngagement,
  MainDashboardWidgets,
  WidgetPeriod,
} from './communicationsServices';
import type { IntegrationConfig } from './trainingServices';
import type { LeaveOfAbsenceResponse, TrainingWaiverResponse } from './facilitiesServices';
import type { PlatformAnalytics } from '../types/platformAnalytics';
import { asArray } from '../utils/asArray';

export const securityService = {
  async getStatus(): Promise<SecurityStatus> {
    const response = await api.get<SecurityStatus>('/security/status');
    return response.data;
  },

  async getAlerts(params?: {
    limit?: number;
    threat_level?: string;
    alert_type?: string;
  }): Promise<{ alerts: SecurityAlert[]; total: number }> {
    const response = await api.get<{ alerts: SecurityAlert[]; total: number }>('/security/alerts', { params });
    return response.data;
  },

  async acknowledgeAlert(alertId: string): Promise<{ status: string; alert_id: string }> {
    const response = await api.post<{ status: string; alert_id: string }>(`/security/alerts/${alertId}/acknowledge`);
    return response.data;
  },

  async verifyAuditIntegrity(params?: {
    start_id?: number;
    end_id?: number;
  }): Promise<{ verified: boolean; total_checked: number; errors: string[] }> {
    const response = await api.get<{ verified: boolean; total_checked: number; errors: string[] }>(
      '/security/audit-log/integrity',
      { params }
    );
    return response.data;
  },

  async triggerManualCheck(): Promise<{
    check_completed: boolean;
    overall_status: string;
    integrity: Record<string, unknown>;
  }> {
    const response = await api.post<{
      check_completed: boolean;
      overall_status: string;
      integrity: Record<string, unknown>;
    }>('/security/manual-check');
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
  instructor_id?: string;
  co_instructors?: string[];
  apparatus_id?: string;
  issues_certification: boolean;
  certification_number_prefix?: string;
  issuing_agency?: string;
  expiration_months?: number;
  // False when the session's hours must not advance linked certificate
  // requirements (delivery a certifying body wouldn't accept).
  counts_toward_certification: boolean;
  auto_create_records: boolean;
  require_completion_confirmation: boolean;
  approval_deadline_days: number;
  is_finalized: boolean;
  finalized_at?: string;
  finalized_by?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
}

/**
 * Partial update of a session's requirement/program links.
 *
 * An update payload, so the three states are distinct on the wire: omit the
 * key to leave a link alone, send `null` to clear it, send an id to set it.
 * `undefined` is not one of them — use `null` to clear (CLAUDE.md pitfall #1).
 */
export interface TrainingSessionLinkageUpdate {
  category_id?: string | null;
  program_id?: string | null;
  phase_id?: string | null;
  requirement_id?: string | null;
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
  async trackEvent(data: {
    event_type: string;
    event_id: string;
    user_id?: string | undefined;
    metadata: Record<string, unknown>;
  }): Promise<void> {
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
  /** Resolved server-side from user_id; null once the account is deleted. */
  user_name?: string | null;
  user_username?: string | null;
  event_id?: string;
  created_at: string;
}

export interface ErrorLogStats {
  total: number;
  by_type: Record<string, number>;
  recent_errors: ErrorLogRecord[];
}

export interface ErrorCodeEntry {
  code: string;
  category: string;
  title: string;
  description: string;
  resolution: string[];
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

  async getErrors(params?: {
    error_type?: string;
    event_id?: string;
    skip?: number;
    limit?: number;
  }): Promise<{ errors: ErrorLogRecord[]; total: number }> {
    const response = await api.get<{ errors: ErrorLogRecord[]; total: number }>('/errors', { params });
    return response.data;
  },

  async getStats(): Promise<ErrorLogStats> {
    const response = await api.get<ErrorLogStats>('/errors/stats');
    return response.data;
  },

  async getErrorCodes(): Promise<ErrorCodeEntry[]> {
    const response = await api.get<{ codes: ErrorCodeEntry[] }>('/errors/codes');
    return response.data.codes;
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
// Audit Log Service (admin-only, requires audit.view)
// ============================================

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditLogEntry {
  id: number;
  timestamp: string | null;
  event_type: string;
  event_category: string;
  severity: AuditSeverity | null;
  user_id: string | null;
  username: string | null;
  ip_address: string | null;
  event_data: Record<string, unknown>;
}

export interface AuditLogListResponse {
  logs: AuditLogEntry[];
  total: number;
  skip: number;
  limit: number;
}

export interface AuditLogStats {
  total: number;
  by_severity: Partial<Record<AuditSeverity, number>>;
  by_category: Record<string, number>;
}

export interface AuditLogFilters {
  event_type?: string | undefined;
  event_category?: string | undefined;
  severity?: AuditSeverity | undefined;
  user_id?: string | undefined;
  search?: string | undefined;
  start_date?: string | undefined;
  end_date?: string | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
}

export const auditLogService = {
  async list(filters: AuditLogFilters = {}): Promise<AuditLogListResponse> {
    const response = await api.get<AuditLogListResponse>('/audit-logs', { params: filters });
    return response.data;
  },

  async getStats(): Promise<AuditLogStats> {
    const response = await api.get<AuditLogStats>('/audit-logs/stats');
    return response.data;
  },

  async getEntry(id: number): Promise<AuditLogEntry> {
    const response = await api.get<AuditLogEntry>(`/audit-logs/${id}`);
    return response.data;
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
  async getWidgets(period: WidgetPeriod): Promise<MainDashboardWidgets> {
    const response = await api.get<MainDashboardWidgets>('/dashboard/widgets', { params: { period } });
    return response.data;
  },
  async getAssetWidgets(): Promise<import('../components/dashboard/AssetWidgetRegistry').AssetWidgetData[]> {
    const response = await api.get<{
      widgets: import('../components/dashboard/AssetWidgetRegistry').AssetWidgetData[];
    }>('/dashboard/asset-widgets');
    return response.data.widgets;
  },
  async getStats(): Promise<DashboardStats> {
    const response = await api.get<DashboardStats>('/dashboard/stats');
    return response.data;
  },
  async getAdminSummary(): Promise<AdminSummary> {
    const response = await api.get<AdminSummary>('/dashboard/admin-summary');
    return response.data;
  },
  async getOperations(): Promise<OperationsDashboard> {
    const response = await api.get<OperationsDashboard>('/dashboard/operations');
    return response.data;
  },
  async getActionItems(params?: {
    status_filter?: string | undefined;
    assigned_to_me?: boolean | undefined;
  }): Promise<ActionItemSummary[]> {
    const response = await api.get<ActionItemSummary[]>('/dashboard/action-items', { params });
    return asArray(response.data);
  },
  async getCommunityEngagement(): Promise<CommunityEngagement> {
    const response = await api.get<CommunityEngagement>('/dashboard/community-engagement');
    return response.data;
  },
  /**
   * Department name and logo.
   *
   * De-duplicated because the app shell and the dashboard both ask on a first
   * visit, guarded by different storage keys, and neither has written its key
   * by the time the other fires. It is also the one branding read that cannot
   * fall back on the response cache: `/auth/` is excluded from caching for
   * credential endpoints, and this public endpoint is caught by that prefix.
   */
  async getBranding(): Promise<{ name?: string; logo?: string }> {
    return dedupeInFlight('auth/branding', async () => {
      const response = await api.get<{ name?: string; logo?: string }>('/auth/branding');
      return response.data;
    });
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
  /** Which named footer this template closes with; null/absent means the department's default. */
  footer_key?: string | null;
  /** Accent hex driving the header rule, chip, panel edge and button. */
  header_accent?: string | null;
  /** The uppercase pill in the header lockup. */
  status_chip?: string | null;
  /** notice | receipt | digest */
  layout?: string | null;
  allow_attachments: boolean;
  is_active: boolean;
  default_cc?: string[];
  default_bcc?: string[];
  available_variables: TemplateVariable[];
  /**
   * Whether the department has changed anything Reset would put back.
   * Computed per request by the list endpoint only, so a template fetched
   * on its own reports the schema default rather than a real answer.
   */
  is_customized?: boolean;
  /** Messages sent with this template type. List endpoint only, as above. */
  sent_count?: number;
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
  /** Empty string selects the department's default footer. */
  footer_key?: string;
  /** One of the seven accents; the API rejects anything else. */
  header_accent?: string;
  status_chip?: string;
  /** notice | receipt | digest */
  layout?: string;
  description?: string;
  is_active?: boolean;
  allow_attachments?: boolean;
  default_cc?: string[] | null;
  default_bcc?: string[] | null;
}

/** What the preview endpoint will render instead of the stored template. */
export interface TemplatePreviewOverrides {
  subject?: string;
  html_body?: string;
  text_body?: string;
  css_styles?: string;
  /** Empty string is meaningful here: it selects the department's default footer. */
  footer_key?: string;
  /**
   * One of the seven accents, or omitted. These two are typed `| undefined`
   * because a template may have neither set — the renderer then falls back to
   * the colourway shipped for its type — and the API rejects the empty string
   * an unset form field would otherwise send. See `previewOverrides` in
   * EmailTemplatesPage.
   */
  header_accent?: string | undefined;
  status_chip?: string;
  /** notice | receipt | digest, or omitted. */
  layout?: string | undefined;
}

export interface EmailTemplatePreview {
  subject: string;
  html_body: string;
  text_body: string;
}

export interface EmailFooter {
  key: string;
  name: string;
  description?: string;
  lines: string[];
  show_contact: boolean;
  show_mailing_address: boolean;
}

export interface EmailFooterLibrary {
  default_key: string;
  footers: EmailFooter[];
  /** Variables a footer line may use — the organization-wide ones only. */
  variables: TemplateVariable[];
  /** Templates currently closing with each footer, keyed by footer key. */
  usage: Record<string, number>;
}

export const reportsService = {
  async getAvailableReports(): Promise<{
    available_reports: Array<{ id: string; title: string; description: string; category: string; available: boolean }>;
  }> {
    const response = await api.get<{
      available_reports: Array<{
        id: string;
        title: string;
        description: string;
        category: string;
        available: boolean;
      }>;
    }>('/reports/available');
    return response.data;
  },

  async generateReport(data: {
    report_type: string;
    start_date?: string;
    end_date?: string;
    filters?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
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
  /**
   * Whether a sender actually consults this rule. Rules for triggers that
   * have no sender yet are stored and listed but never read — the UI says so
   * rather than showing them as plain "Active".
   */
  enforced: boolean;
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
  async changeStatus(
    userId: string,
    data: import('../types/user').MemberStatusChangeRequest
  ): Promise<import('../types/user').MemberStatusChangeResponse> {
    const response = await api.patch<import('../types/user').MemberStatusChangeResponse>(
      `/users/${userId}/status`,
      data
    );
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
    const response = await api.get<{ members: import('../types/user').OverdueMember[] }>(
      '/users/property-return-reminders/overdue'
    );
    return response.data;
  },

  async processPropertyReturnReminders(): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/users/property-return-reminders/process');
    return response.data;
  },

  async getPropertyReturnPreview(userId: string): Promise<import('../types/user').PropertyReturnReport> {
    const response = await api.get<import('../types/user').PropertyReturnReport>(
      `/users/${userId}/property-return-report`
    );
    return response.data;
  },

  async getTierConfig(): Promise<import('../types/user').MembershipTierConfig> {
    const response = await api.get<import('../types/user').MembershipTierConfig>('/users/membership-tiers/config');
    return response.data;
  },

  async updateTierConfig(
    config: import('../types/user').MembershipTierConfig
  ): Promise<import('../types/user').MembershipTierConfig> {
    const response = await api.put<import('../types/user').MembershipTierConfig>(
      '/users/membership-tiers/config',
      config
    );
    return response.data;
  },

  async advanceMembershipTiers(): Promise<Record<string, unknown>> {
    const response = await api.post<Record<string, unknown>>('/users/advance-membership-tiers');
    return response.data;
  },

  // Leave of Absence
  async listLeavesOfAbsence(params?: { user_id?: string; active_only?: boolean }): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>('/users/leaves-of-absence', { params });
    return asArray(response.data);
  },

  async getMemberLeaves(userId: string, activeOnly = true): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>(`/users/${userId}/leaves-of-absence`, {
      params: { active_only: activeOnly },
    });
    return asArray(response.data);
  },

  async getMyLeaves(): Promise<LeaveOfAbsenceResponse[]> {
    const response = await api.get<LeaveOfAbsenceResponse[]>('/users/leaves-of-absence/me');
    return asArray(response.data);
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

  async updateLeaveOfAbsence(
    leaveId: string,
    data: {
      leave_type?: string;
      reason?: string;
      start_date?: string;
      end_date?: string;
      active?: boolean;
      exempt_from_training_waiver?: boolean;
    }
  ): Promise<LeaveOfAbsenceResponse> {
    const response = await api.patch<LeaveOfAbsenceResponse>(`/users/leaves-of-absence/${leaveId}`, data);
    return response.data;
  },

  async deleteLeaveOfAbsence(leaveId: string): Promise<void> {
    await api.delete(`/users/leaves-of-absence/${leaveId}`);
  },

  // Training Waivers
  async listTrainingWaivers(params?: { user_id?: string; active_only?: boolean }): Promise<TrainingWaiverResponse[]> {
    const response = await api.get<TrainingWaiverResponse[]>('/training/waivers', { params });
    return asArray(response.data);
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

  async updateTrainingWaiver(
    waiverId: string,
    data: {
      waiver_type?: string;
      reason?: string;
      start_date?: string;
      end_date?: string;
      requirement_ids?: string[];
      active?: boolean;
    }
  ): Promise<TrainingWaiverResponse> {
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
  scheduled_at?: string;
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
  total_targeted: number;
  total_reads: number;
  total_acknowledged: number;
}

export interface AckReportRecipient {
  user_id: string;
  name: string;
  status?: string;
  is_read: boolean;
  read_at?: string;
  is_acknowledged: boolean;
  acknowledged_at?: string;
  /**
   * The member was removed from the audience after this message published.
   * Their receipt is kept as evidence — it is the only record that they read
   * or acknowledged it — but they are outside the totals and can no longer
   * act on it, so an unacknowledged one is not an outstanding obligation.
   */
  removed_from_audience?: boolean;
}

export interface AcknowledgmentReport {
  message_id: string;
  requires_acknowledgment: boolean;
  total_targeted: number;
  total_read: number;
  total_acknowledged: number;
  recipients: AckReportRecipient[];
}

export interface RoleOption {
  id: string;
  name: string;
  slug: string;
}

export const shiftCompletionService = {
  async createReport(
    data: import('../types/training').ShiftCompletionReportCreate
  ): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>('/training/shift-reports', data);
    return response.data;
  },

  async getMyReports(params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      '/training/shift-reports/my-reports',
      { params }
    );
    return response.data;
  },

  async getMyStats(params?: {
    start_date?: string;
    end_date?: string;
  }): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get<import('../types/training').TraineeShiftStats>('/training/shift-reports/my-stats', {
      params,
    });
    return response.data;
  },

  async getReportsByOfficer(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      '/training/shift-reports/by-officer'
    );
    return response.data;
  },

  async getReportsForTrainee(
    traineeId: string,
    params?: { start_date?: string; end_date?: string }
  ): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      `/training/shift-reports/trainee/${traineeId}`,
      { params }
    );
    return response.data;
  },

  async getTraineeStats(
    traineeId: string,
    params?: { start_date?: string; end_date?: string }
  ): Promise<import('../types/training').TraineeShiftStats> {
    const response = await api.get<import('../types/training').TraineeShiftStats>(
      `/training/shift-reports/trainee/${traineeId}/stats`,
      { params }
    );
    return response.data;
  },

  async getAllReports(params?: {
    trainee_id?: string;
    officer_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>('/training/shift-reports/all', {
      params,
    });
    return response.data;
  },

  async getReport(reportId: string): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.get<import('../types/training').ShiftCompletionReport>(
      `/training/shift-reports/${reportId}`
    );
    return response.data;
  },

  async acknowledgeReport(
    reportId: string,
    comments?: string
  ): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>(
      `/training/shift-reports/${reportId}/acknowledge`,
      { trainee_comments: comments }
    );
    return response.data;
  },

  async getPendingReviewReports(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      '/training/shift-reports/pending-review'
    );
    return response.data;
  },

  async getFlaggedReports(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      '/training/shift-reports/flagged'
    );
    return response.data;
  },

  async getDraftReports(): Promise<import('../types/training').ShiftCompletionReport[]> {
    const response = await api.get<import('../types/training').ShiftCompletionReport[]>(
      '/training/shift-reports/drafts'
    );
    return response.data;
  },

  async submitAllDrafts(): Promise<{ submitted: number; total: number }> {
    const response = await api.post<{ submitted: number; total: number }>('/training/shift-reports/drafts/submit-all');
    return response.data;
  },

  async updateReport(
    reportId: string,
    data: Partial<import('../types/training').ShiftCompletionReportCreate> & { review_status?: string }
  ): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.put<import('../types/training').ShiftCompletionReport>(
      `/training/shift-reports/${reportId}`,
      data
    );
    return response.data;
  },

  async reviewReport(
    reportId: string,
    data: { review_status: string; reviewer_notes?: string | undefined; redact_fields?: string[] | undefined }
  ): Promise<import('../types/training').ShiftCompletionReport> {
    const response = await api.post<import('../types/training').ShiftCompletionReport>(
      `/training/shift-reports/${reportId}/review`,
      data
    );
    return response.data;
  },

  async batchReviewReports(data: {
    report_ids: string[];
    review_status: string;
    reviewer_notes?: string;
  }): Promise<{ reviewed: number; failed: number }> {
    const response = await api.post<{ reviewed: number; failed: number }>('/training/shift-reports/batch-review', data);
    return response.data;
  },

  async getOfficerAnalytics(): Promise<import('../types/training').OfficerShiftAnalytics> {
    const response = await api.get<import('../types/training').OfficerShiftAnalytics>(
      '/training/shift-reports/officer-analytics'
    );
    return response.data;
  },

  async previewShiftData(
    shiftId: string,
    traineeId: string
  ): Promise<{ hours_on_shift: number | null; calls_responded: number; call_types: string[] }> {
    const response = await api.get<{ hours_on_shift: number | null; calls_responded: number; call_types: string[] }>(
      `/training/shift-reports/shift-preview/${shiftId}/${traineeId}`
    );
    return response.data;
  },

  async getShiftCrewStatus(shiftId: string): Promise<import('../types/training').ShiftCrewMember[]> {
    const response = await api.get<import('../types/training').ShiftCrewMember[]>(
      `/training/shift-reports/shift-crew/${shiftId}`
    );
    return response.data;
  },

  async batchCreateReports(
    data: import('../types/training').BatchShiftReportCreate
  ): Promise<import('../types/training').BatchShiftReportResponse> {
    const response = await api.post<import('../types/training').BatchShiftReportResponse>(
      '/training/shift-reports/batch',
      data
    );
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

export interface CalcomBooking {
  external_id: string;
  title: string;
  description: string;
  location: string;
  start_time: string;
  end_time: string;
  status: string;
  attendee_emails: string[];
}

export interface SalesforceSyncStatus {
  connected: boolean;
  last_sync_at: string | null;
  sync_direction: string;
  sync_types: string[];
  environment: string;
  field_mappings: Record<string, Record<string, string>>;
}

export interface SalesforceSyncResult {
  success: boolean;
  message: string;
  created: number;
  updated: number;
  failed: number;
  adopted?: number;
  skipped?: number;
  skipped_fields?: string[];
}

export interface SalesforcePullResult {
  success: boolean;
  contacts: Record<string, unknown>[];
  count: number;
  inbound_enabled: boolean;
  persisted: number;
  updated: number;
  unchanged: number;
  unmatched: number;
  failed: number;
}

export interface SalesforceReadinessObject {
  accessible: boolean;
  missing_fields: string[];
  error: string | null;
}

export interface SalesforceReadiness {
  connected: boolean;
  objects: Record<string, SalesforceReadinessObject>;
  external_id_fields_ready: boolean;
  ready: boolean;
  error?: string;
}

export interface SalesforcePreviewResult {
  success: boolean;
  total: number;
  would_create: number;
  would_update: number;
  would_adopt: number;
  skipped: number;
}

// Minimal connection-status shape returned by GET /integrations/connected — no
// config/secrets, just enough for feature modules to gate integration-backed UI.
export interface IntegrationStatus {
  integration_type: string;
  status: string;
  enabled: boolean;
}

// ---- Claude (MCP) service keys ------------------------------------------
// The plaintext key appears exactly once, in the create response; every
// other shape carries only the display prefix.
export interface McpServiceKey {
  id: string;
  name: string;
  key_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string | null;
  created_by: string | null;
  is_active: boolean;
}

export interface McpStatus {
  enabled: boolean;
  endpoint_path: string;
  access_mode: 'read_only' | 'read_write';
  expose_finance: boolean;
  expose_medical_screening: boolean;
  expose_full_schedule: boolean;
  active_key: McpServiceKey | null;
}

export interface McpKeyCreateResult {
  key: McpServiceKey;
  plaintext: string;
  revoked: McpServiceKey[];
  endpoint_path: string;
}

export const integrationsService = {
  async getIntegrations(): Promise<IntegrationConfig[]> {
    const response = await api.get<IntegrationConfig[]>('/integrations');
    return asArray(response.data);
  },

  async getIntegration(integrationId: string): Promise<IntegrationConfig> {
    const response = await api.get<IntegrationConfig>(`/integrations/${integrationId}`);
    return response.data;
  },

  // Connection-status projection (no config) for non-admin cross-module callers.
  // The full list/detail endpoints require integrations.manage; this one is
  // readable by any org member so feature modules can offer integration-backed
  // options without holding the integrations-admin permission (INT-3).
  async getConnectedIntegrationStatus(): Promise<IntegrationStatus[]> {
    const response = await api.get<IntegrationStatus[]>('/integrations/connected');
    return asArray(response.data);
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

  async getCalcomBookings(): Promise<CalcomBooking[]> {
    const response = await api.get<{ bookings: CalcomBooking[] }>('/integrations/calcom/bookings');
    return asArray(response.data?.bookings);
  },

  async salesforceSyncStatus(): Promise<SalesforceSyncStatus> {
    const response = await api.get<SalesforceSyncStatus>('/integrations/salesforce/status');
    return response.data;
  },

  async salesforcePushMembers(): Promise<SalesforceSyncResult> {
    const response = await api.post<SalesforceSyncResult>('/integrations/salesforce/push/members');
    return response.data;
  },

  async salesforcePushTraining(): Promise<SalesforceSyncResult> {
    const response = await api.post<SalesforceSyncResult>('/integrations/salesforce/push/training');
    return response.data;
  },

  async salesforcePushEvents(): Promise<SalesforceSyncResult> {
    const response = await api.post<SalesforceSyncResult>('/integrations/salesforce/push/events');
    return response.data;
  },

  async salesforcePullContacts(): Promise<SalesforcePullResult> {
    const response = await api.post<SalesforcePullResult>('/integrations/salesforce/pull/contacts');
    return response.data;
  },

  async salesforceReadiness(): Promise<SalesforceReadiness> {
    const response = await api.get<SalesforceReadiness>('/integrations/salesforce/readiness');
    return response.data;
  },

  async salesforcePreviewMembers(): Promise<SalesforcePreviewResult> {
    const response = await api.post<SalesforcePreviewResult>('/integrations/salesforce/preview/members');
    return response.data;
  },

  // Full-page navigation target for the one-click OAuth connect flow. Not an
  // axios call — the browser navigates here and the backend 302s to Salesforce.
  getSalesforceOAuthUrl(): string {
    const baseUrl = api.defaults.baseURL || '';
    return `${baseUrl}/integrations/salesforce/oauth/authorize`;
  },

  async getMcpStatus(): Promise<McpStatus> {
    const response = await api.get<McpStatus>('/integrations/claude-mcp/status');
    return response.data;
  },

  async listMcpKeys(): Promise<McpServiceKey[]> {
    const response = await api.get<{ keys: McpServiceKey[] }>('/integrations/claude-mcp/keys');
    return asArray(response.data.keys);
  },

  // ``expiresInDays`` null issues a lifetime key.
  async createMcpKey(name: string, expiresInDays: number | null): Promise<McpKeyCreateResult> {
    const response = await api.post<McpKeyCreateResult>('/integrations/claude-mcp/keys', {
      name,
      expires_in_days: expiresInDays,
    });
    return response.data;
  },

  async revokeMcpKey(keyId: string): Promise<McpServiceKey> {
    const response = await api.delete<{ key: McpServiceKey }>(`/integrations/claude-mcp/keys/${keyId}`);
    return response.data.key;
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
