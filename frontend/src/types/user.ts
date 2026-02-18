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
  phone?: string;
  mobile?: string;
  photo_url?: string;
  status: string;
  hire_date?: string;
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
  badge_number?: string;
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
