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
  description?: string;
  color?: string;
  require_approval?: boolean;
  auto_approve_under_hours?: number | null;
  max_hours_per_session?: number | null;
  sort_order?: number;
}

export interface AdminHoursCategoryUpdate {
  name?: string;
  description?: string | null;
  color?: string | null;
  require_approval?: boolean;
  auto_approve_under_hours?: number | null;
  max_hours_per_session?: number | null;
  is_active?: boolean;
  sort_order?: number;
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
  description?: string;
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
