/**
 * User type definitions
 */

export interface User {
  id: string;
  organization_id: string;
  username: string;
  email?: string;
  personal_email?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;
  membership_number?: string;
  phone?: string;
  mobile?: string;
  photo_url?: string;
  rank?: string;
  station?: string;
  status: string;
  membership_type?: string;
  date_of_birth?: string;
  hire_date?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  address_country?: string;
  emergency_contacts?: EmergencyContact[];
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
  email?: string;
  phone?: string;
  mobile?: string;
  notification_preferences?: NotificationPreferences;
}

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  is_primary: boolean;
}

export interface UserProfileUpdate {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  phone?: string;
  mobile?: string;
  personal_email?: string;
  membership_number?: string;
  date_of_birth?: string;
  hire_date?: string;
  rank?: string;
  station?: string;
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  address_country?: string;
  emergency_contacts?: EmergencyContact[];
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

export interface DeletionImpact {
  user_id: string;
  full_name?: string;
  status: string;
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
