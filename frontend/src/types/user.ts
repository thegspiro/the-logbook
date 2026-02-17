/**
 * User type definitions
 */

export interface User {
  id: string;
  organization_id: string;
  username: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  badge_number?: string;
  membership_number?: string;
  phone?: string;
  mobile?: string;
  photo_url?: string;
  status: string;
  hire_date?: string;
}

export interface MembershipIdSettings {
  enabled: boolean;
  prefix: string;
  next_number: number;
  padding: number;
}

export interface ContactInfoSettings {
  enabled: boolean;
  show_email: boolean;
  show_phone: boolean;
  show_mobile: boolean;
}

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
  email_notifications: boolean;
  event_reminders: boolean;
  training_reminders: boolean;
  announcement_notifications: boolean;
}

export interface ContactInfoUpdate {
  email?: string;
  phone?: string;
  mobile?: string;
  notification_preferences?: NotificationPreferences;
}

// ==================== Member Status & Lifecycle ====================

export type UserStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'probationary'
  | 'retired'
  | 'dropped_voluntary'
  | 'dropped_involuntary'
  | 'archived';

export interface MemberStatusChangeRequest {
  new_status: UserStatus;
  reason?: string;
  send_property_return_email?: boolean;
  return_deadline_days?: number;
  custom_instructions?: string;
}

export interface MemberStatusChangeResponse {
  user_id: string;
  previous_status: string;
  new_status: string;
  property_return_report?: PropertyReturnReport;
  document_id?: string;
  email_sent?: boolean;
}

export interface PropertyReturnReport {
  member_name: string;
  item_count: number;
  total_value: number;
  items: unknown[];
  html: string;
}

export interface ArchiveMemberRequest {
  reason?: string;
}

export interface ReactivateMemberRequest {
  reason?: string;
}

export interface ArchivedMember {
  user_id: string;
  name: string;
  email: string;
  badge_number: string;
  rank: string;
  archived_at: string;
  status_change_reason: string;
}

export interface ArchivedMembersResponse {
  organization_id: string;
  archived_count: number;
  members: ArchivedMember[];
}

export interface OverdueMember {
  member_name: string;
  drop_date: string;
  days_since_drop: number;
  items_outstanding: unknown[];
  reminders_sent: Record<string, unknown>;
}

export interface OverduePropertyReturnsResponse {
  organization_id: string;
  overdue_count: number;
  members: OverdueMember[];
}

export interface MembershipTypeChangeRequest {
  membership_type: string;
  reason?: string;
}

export interface MembershipTypeChangeResponse {
  user_id: string;
  member_name: string;
  previous_membership_type: string;
  new_membership_type: string;
  changed_at: string;
}

export interface AdvanceTiersResponse {
  organization_id: string;
  advanced: number;
  members: {
    user_id: string;
    name: string;
    previous_tier: string;
    new_tier: string;
    years_of_service: number;
  }[];
}

export interface MembershipTierBenefits {
  training_exempt: boolean;
  training_exempt_types: string[];
  voting_eligible: boolean;
  voting_requires_meeting_attendance: boolean;
  voting_min_attendance_pct: number;
  voting_attendance_period_months: number;
  can_hold_office: boolean;
  custom_benefits: Record<string, unknown>;
}

export interface MembershipTier {
  id: string;
  name: string;
  years_required: number;
  sort_order: number;
  benefits: MembershipTierBenefits;
}

export interface MembershipTierConfig {
  auto_advance: boolean;
  tiers: MembershipTier[];
}
