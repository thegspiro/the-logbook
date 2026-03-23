/**
 * User type definitions
 */

import type { UserStatus } from '../constants/enums';

export interface User {
  id: string;
  organization_id: string;
  username: string;
  email?: string | undefined;
  personal_email?: string | undefined;
  first_name?: string | undefined;
  middle_name?: string | undefined;
  last_name?: string | undefined;
  full_name?: string | undefined;
  membership_number?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
  photo_url?: string | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  status: UserStatus;
  membership_type?: string | undefined;
  compliance_exempt?: boolean | undefined;
  date_of_birth?: string | undefined;
  hire_date?: string | undefined;
  address_street?: string | undefined;
  address_city?: string | undefined;
  address_state?: string | undefined;
  address_zip?: string | undefined;
  address_country?: string | undefined;
  emergency_contacts?: EmergencyContact[] | undefined;
}

export interface ContactInfoSettings {
  enabled: boolean;
  show_email: boolean;
  show_phone: boolean;
  show_mobile: boolean;
}

export interface MembershipIdSettings {
  enabled: boolean;
  auto_generate: boolean;
  prefix: string;
  next_number: number;
}

export const DepartmentEmailFormat = {
  FIRST_DOT_LAST: 'first.last',
  FIRST_INITIAL_LAST: 'flast',
  FIRST_LAST: 'firstlast',
  LAST_DOT_FIRST: 'last.first',
} as const;
export type DepartmentEmailFormat = (typeof DepartmentEmailFormat)[keyof typeof DepartmentEmailFormat];

export interface DepartmentEmailSettings {
  enabled: boolean;
  domain: string;
  format: DepartmentEmailFormat;
}

export interface EmailServiceSettings {
  enabled: boolean;
  platform: string;
  // Gmail / Google Workspace
  google_client_id?: string;
  google_client_secret?: string;
  google_app_password?: string;
  // Microsoft 365
  microsoft_tenant_id?: string;
  microsoft_client_id?: string;
  microsoft_client_secret?: string;
  // Self-hosted SMTP
  smtp_host?: string;
  smtp_port: number;
  smtp_user?: string;
  smtp_password?: string;
  smtp_encryption: string;
  // Common
  from_email?: string;
  from_name?: string;
  use_tls: boolean;
}

export interface FileStorageSettings {
  platform: string;
  // Google Drive
  google_drive_client_id?: string;
  google_drive_client_secret?: string;
  google_drive_folder_id?: string;
  // OneDrive / SharePoint
  onedrive_tenant_id?: string;
  onedrive_client_id?: string;
  onedrive_client_secret?: string;
  sharepoint_site_url?: string;
  // Amazon S3
  s3_access_key_id?: string;
  s3_secret_access_key?: string;
  s3_bucket_name?: string;
  s3_region?: string;
  s3_endpoint_url?: string;
  // Local
  local_storage_path?: string;
}

export interface AuthSettings {
  provider: string;
  // Google OAuth
  google_client_id?: string;
  google_client_secret?: string;
  // Microsoft Azure AD
  microsoft_tenant_id?: string;
  microsoft_client_id?: string;
  microsoft_client_secret?: string;
  // Authentik SSO
  authentik_url?: string;
  authentik_client_id?: string;
  authentik_client_secret?: string;
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
  email?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
  notification_preferences?: NotificationPreferences | undefined;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string | undefined;
  is_primary: boolean;
}

export interface UserProfileUpdate {
  first_name?: string | undefined;
  middle_name?: string | undefined;
  last_name?: string | undefined;
  phone?: string | undefined;
  mobile?: string | undefined;
  personal_email?: string | undefined;
  membership_number?: string | undefined;
  date_of_birth?: string | undefined;
  hire_date?: string | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  address_street?: string | undefined;
  address_city?: string | undefined;
  address_state?: string | undefined;
  address_zip?: string | undefined;
  address_country?: string | undefined;
  emergency_contacts?: EmergencyContact[] | undefined;
}

export interface ArchivedMember {
  user_id: string;
  name: string;
  email?: string;
  membership_number?: string;
  rank?: string;
  archived_at?: string;
  status_change_reason?: string;
}

export interface OverdueMember {
  user_id: string;
  name: string;
  member_name: string;
  email?: string;
  membership_number?: string;
  drop_date: string;
  days_since_drop: number;
  items_outstanding: unknown[];
  items: Array<{
    item_id: string;
    item_name: string;
    due_date: string;
    days_overdue: number;
  }>;
}

export interface MembershipTierBenefits {
  voting_rights?: boolean;
  voting_eligible?: boolean;
  voting_requires_meeting_attendance?: boolean;
  voting_min_attendance_pct?: number;
  voting_attendance_period_months?: number;
  can_hold_office?: boolean;
  training_exempt?: boolean;
  training_exempt_types?: string[];
  discount_percentage?: number;
  custom_benefits?: Record<string, unknown>;
  [key: string]: unknown;
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

export interface PropertyReturnReport {
  user_id: string;
  name: string;
  member_name: string;
  item_count: number;
  total_value: number;
  html?: string;
  items: unknown[];
}

export interface MemberStatusChangeRequest {
  new_status: string;
  reason?: string | undefined;
  send_property_return_email?: boolean | undefined;
  return_deadline_days?: number | undefined;
  custom_instructions?: string | undefined;
}

export interface MemberStatusChangeResponse {
  user_id: string;
  previous_status: string;
  new_status: string;
  property_return_report?: {
    member_name: string;
    drop_type: string;
    item_count: number;
    total_value: number;
    return_deadline: string;
  };
  document_id?: string;
  email_sent?: boolean;
}

export interface DeletionImpact {
  user_id: string;
  full_name?: string;
  status: UserStatus;
  training_records: number;
  inventory_items: number;
  documents: number;
  total_records: number;
}

export interface MemberAuditLogEntry {
  id: number;
  timestamp: string;
  event_type: string;
  severity: string;
  description: string;
  changed_by_username?: string;
  changed_by_user_id?: string;
  event_data?: Record<string, unknown>;
}
