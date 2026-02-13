/**
 * Membership Module Types
 *
 * Re-exports types from the shared types directory and adds
 * module-specific types for the membership Zustand store.
 */

// Re-export existing member types
export type {
  Member,
  MemberFormData,
  CSVMemberRow,
  MemberStats,
  EmergencyContact,
  Address,
  ContactInfo,
  Certification,
} from '../../../types/member';

export type {
  User,
  ContactInfoSettings,
  NotificationPreferences,
  ContactInfoUpdate,
} from '../../../types/user';

import type { User } from '../../../types/user';

// =============================================================================
// Pagination & Filtering
// =============================================================================

export interface PaginatedMemberList {
  items: User[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface MemberListFilters {
  status?: string;
  membership_type?: string;
  search?: string;
  rank?: string;
  station?: string;
}
