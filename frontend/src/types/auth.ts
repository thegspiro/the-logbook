/**
 * Authentication type definitions
 */

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  badge_number?: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  organization_id: string;
  roles: string[];
  permissions: string[];
  is_active: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
}

export interface PasswordChangeData {
  current_password: string;
  new_password: string;
}
