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

export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
}

export interface ContactInfoUpdate {
  email?: string;
  phone?: string;
  mobile?: string;
  notification_preferences?: NotificationPreferences;
}
