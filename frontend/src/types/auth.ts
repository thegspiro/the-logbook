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
  mfa_enrollment_required?: boolean;
  password_expired: boolean;
  must_change_password: boolean;
  /**
   * The member's chosen phone bottom-bar tabs, left then right of Quick Add.
   * Null or absent when they have never chosen, which leaves the bar on its
   * role-based defaults.
   */
  bottom_nav_slots?: string[] | null;
}

export interface PasswordChangeData {
  current_password: string;
  new_password: string;
}

export interface PasswordResetRequest {
  email: string;
}

/** What `POST /auth/forgot-password` answers — the same for every address. */
export interface PasswordResetRequestResponse {
  message: string;
  /** How long an emailed link lasts; absent from older backends. */
  expires_in_minutes?: number | undefined;
  /** Set when the department signs in through an outside provider, and no link is sent. */
  auth_provider?: string | undefined;
}

export interface PasswordResetConfirm {
  token: string;
  new_password: string;
}
