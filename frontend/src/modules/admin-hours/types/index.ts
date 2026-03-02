/**
 * Admin Hours Types
 */

export interface AdminHoursCategory {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  color: string | null;
  requireApproval: boolean;
  autoApproveUnderHours: number | null;
  maxHoursPerSession: number | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminHoursCategoryCreate {
  name: string;
  description?: string | undefined;
  color?: string | undefined;
  require_approval?: boolean | undefined;
  auto_approve_under_hours?: number | null | undefined;
  max_hours_per_session?: number | null | undefined;
  sort_order?: number | undefined;
}

export interface AdminHoursCategoryUpdate {
  name?: string | undefined;
  description?: string | null | undefined;
  color?: string | null | undefined;
  require_approval?: boolean | undefined;
  auto_approve_under_hours?: number | null | undefined;
  max_hours_per_session?: number | null | undefined;
  is_active?: boolean | undefined;
  sort_order?: number | undefined;
}

export interface AdminHoursEntry {
  id: string;
  organizationId: string;
  userId: string;
  categoryId: string;
  clockInAt: string;
  clockOutAt: string | null;
  durationMinutes: number | null;
  description: string | null;
  entryMethod: 'qr_scan' | 'manual';
  status: 'active' | 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  categoryName: string | null;
  categoryColor: string | null;
  userName: string | null;
  approverName: string | null;
}

export interface AdminHoursEntryCreate {
  category_id: string;
  clock_in_at: string;
  clock_out_at: string;
  description?: string | undefined;
}

export interface AdminHoursEntryEdit {
  clock_in_at?: string | undefined;
  clock_out_at?: string | undefined;
  description?: string | undefined;
  category_id?: string | undefined;
}

export interface AdminHoursPaginatedEntries {
  entries: AdminHoursEntry[];
  total: number;
  skip: number;
  limit: number;
}

export interface AdminHoursClockInResponse {
  id: string;
  categoryId: string;
  categoryName: string;
  clockInAt: string;
  status: string;
  message: string;
}

export interface AdminHoursClockOutResponse {
  id: string;
  categoryId: string;
  categoryName: string;
  clockInAt: string;
  clockOutAt: string;
  durationMinutes: number;
  status: string;
  message: string;
}

export interface AdminHoursActiveSession {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  clockInAt: string;
  elapsedMinutes: number;
  maxSessionMinutes: number | null;
}

export interface AdminHoursActiveSessionAdmin {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string | null;
  userId: string;
  userName: string;
  clockInAt: string;
  elapsedMinutes: number;
  maxSessionMinutes: number | null;
  description: string | null;
}

export interface AdminHoursSummary {
  totalHours: number;
  totalEntries: number;
  approvedHours: number;
  approvedEntries: number;
  pendingHours: number;
  pendingEntries: number;
  byCategory: Array<{
    category_id: string;
    category_name: string;
    category_color: string | null;
    total_minutes: number;
    total_hours: number;
    entry_count: number;
  }>;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface AdminHoursQRData {
  categoryId: string;
  categoryName: string;
  categoryDescription: string | null;
  categoryColor: string | null;
  organizationName: string | null;
}
