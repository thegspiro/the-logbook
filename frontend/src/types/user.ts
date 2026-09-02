/**
 * User type definitions
 */

import type { ConsentStatus, UserStatus } from '../constants/enums';

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
  platoon?: string | undefined;
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

/**
 * Which of a member's own contact fields other members may see. The member's
 * choice; the department's `ContactInfoSettings` is a ceiling over the three
 * work fields on top of it. Personal email and the mailing address answer to
 * the member alone. Mirrors `ProfileVisibility` in backend/app/schemas/user.py.
 */
export interface ProfileVisibility {
  email: boolean;
  personal_email: boolean;
  phone: boolean;
  mobile: boolean;
  address: boolean;
}

export type ProfileVisibilityField = keyof ProfileVisibility;

/** Every field, in display order, so a loop can never miss one under `noUncheckedIndexedAccess`. */
export const PROFILE_VISIBILITY_FIELDS: readonly ProfileVisibilityField[] = [
  'email',
  'personal_email',
  'phone',
  'mobile',
  'address',
];

/** What a member who has never chosen gets — identical to the backend defaults. */
export const DEFAULT_PROFILE_VISIBILITY: ProfileVisibility = {
  email: true,
  personal_email: false,
  phone: true,
  mobile: true,
  address: false,
};

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
  // Cloudflare Email Service
  cloudflare_account_id?: string;
  cloudflare_api_token?: string;
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
  /** The master email switch. Absorbed the old duplicate `email` key. */
  email_notifications: boolean;
  /**
   * Mutes the SMS that accompanies an urgent message. Cannot switch texts
   * *on*: the member's own SMS consent is the gate the backend enforces.
   */
  sms_notifications: boolean;
  event_reminders: boolean;
  training_reminders: boolean;
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
  // `| null` on the two dates: this is an update payload, and the backend
  // rejects `''` for an `Optional[date]`. Clearing a date has to send an
  // explicit null, which `exclude_unset` then writes through as a clear.
  date_of_birth?: string | null | undefined;
  hire_date?: string | null | undefined;
  rank?: string | undefined;
  station?: string | undefined;
  platoon?: string | undefined;
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

export interface ConsentItem {
  consent_type: string;
  /** null = never asked; the backend treats that as "no consent" */
  granted: boolean | null;
  updated_at: string | null;
}

export interface ConsentRosterMember {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  rank: string | null;
  station: string | null;
  membership_number: string | null;
  member_status: string | null;
  status: ConsentStatus;
  granted: boolean | null;
  /** UTC ISO timestamp of the member's most recent decision; null if never asked */
  decided_at: string | null;
}

export interface ConsentRoster {
  consent_type: string;
  summary: {
    granted: number;
    declined: number;
    not_answered: number;
    total: number;
  };
  members: ConsentRosterMember[];
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
