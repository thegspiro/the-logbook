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
  membership_number?: string;
}

export interface TokenResponse {
  // SEC: Tokens are no longer included in response bodies — they are
  // transported exclusively via httpOnly cookies to prevent XSS exfiltration.
  token_type?: string;
  expires_in?: number;
  user?: CurrentUser;
  // Present instead of a session when the account has MFA enabled: the caller
  // must complete /auth/mfa/login with this short-lived token + a code.
  mfa_required?: boolean;
  mfa_token?: string;
}

export interface CurrentUser {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  organization_id: string;
  timezone: string;
  /** @deprecated Use `positions` instead. Kept for backward compatibility. */
  roles: string[];
  positions: string[];
  rank: string | null;
  platoon?: string | null;
  membership_type: string | null;
  permissions: string[];
  is_active: boolean;
  email_verified: boolean;
  mfa_enabled: boolean;
  password_expired: boolean;
  must_change_password: boolean;
}

export interface PasswordChangeData {
  current_password: string;
  new_password: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}
