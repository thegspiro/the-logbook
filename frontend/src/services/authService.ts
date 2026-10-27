/**
 * authService — extracted from services/api.ts
 */

import api from './apiClient';
import { clearCache } from '../utils/apiCache';
import { clearInFlight } from '../utils/inFlight';
import { CAPTCHA_HEADER } from '../hooks/useCaptcha';
import type {
  PasskeyAssertion,
  PasskeyCreationOptions,
  PasskeyRegistration,
  PasskeyRequestOptions,
} from '../utils/passkeys';
import type {
  CurrentUser,
  LoginCredentials,
  MfaChallenge,
  MfaPolicy,
  PasskeyList,
  PasskeyRegisterResult,
  PasswordChangeData,
  PasswordResetConfirm,
  PasswordResetRequest,
  PasswordResetRequestResponse,
  KioskSessionResult,
  RegisterData,
  SessionSettings,
  TokenResponse,
} from '../types/auth';

export const authService = {
  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * Complete an MFA-gated login with a TOTP code, a recovery code, or the
   * browser's answer to a passkey challenge from `mfaChallenge`.
   */
  async mfaLogin(payload: {
    temp_token: string;
    code?: string;
    recovery_code?: string;
    passkey_credential?: PasskeyAssertion;
  }): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/mfa/login', payload);
    return response.data;
  },

  /**
   * Which second factors can finish a pending sign-in. `passkey_options` is a
   * fresh single-use challenge, or null when the member has no passkey here.
   */
  async mfaChallenge(tempToken: string): Promise<MfaChallenge> {
    const response = await api.post<MfaChallenge>('/auth/mfa/challenge', { temp_token: tempToken });
    return response.data;
  },

  /**
   * Begin MFA enrollment: returns the secret + otpauth provisioning URI.
   */
  async setupMfa(): Promise<{ secret: string; qr_code_url: string }> {
    const response = await api.post<{ secret: string; qr_code_url: string }>('/auth/mfa/setup');
    return response.data;
  },

  /**
   * Confirm enrollment with a code; returns one-time recovery codes.
   *
   * A retry with the same `idempotencyKey` and code gets the same codes back
   * for a short window, so a lost response does not lose the codes.
   */
  async verifyMfaSetup(code: string, idempotencyKey: string): Promise<{ recovery_codes: string[] }> {
    const response = await api.post<{ recovery_codes: string[] }>(
      '/auth/mfa/verify-setup',
      { code },
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },

  /** Disable MFA (requires a current authenticator code). */
  async disableMfa(code: string): Promise<{ mfa_enabled: boolean }> {
    const response = await api.post<{ mfa_enabled: boolean }>('/auth/mfa/disable', {
      code,
    });
    return response.data;
  },

  /**
   * Regenerate recovery codes (requires a current authenticator code).
   * Returns a fresh one-time set; previous codes stop working. A retry with
   * the same `idempotencyKey` and code gets the same set back.
   */
  async regenerateRecoveryCodes(code: string, idempotencyKey: string): Promise<{ recovery_codes: string[] }> {
    const response = await api.post<{ recovery_codes: string[] }>(
      '/auth/mfa/recovery-codes',
      { code },
      { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return response.data;
  },

  /**
   * Re-verify on this session so sensitive actions open for a few minutes.
   * A passkey or authenticator code when the member has one, otherwise the
   * password.
   */
  async stepUp(proof: {
    code?: string;
    password?: string;
    passkey_credential?: PasskeyAssertion;
  }): Promise<{ verified: boolean; valid_for_minutes: number }> {
    const response = await api.post<{ verified: boolean; valid_for_minutes: number }>('/auth/step-up', proof);
    return response.data;
  },

  /** A passkey challenge for `stepUp`. */
  async getStepUpPasskeyOptions(): Promise<PasskeyRequestOptions> {
    const response = await api.post<PasskeyRequestOptions>('/auth/step-up/passkey-options');
    return response.data;
  },

  /** Current user's MFA status. */
  async getMfaStatus(): Promise<{
    mfa_enabled: boolean;
    passkey_count?: number;
    recovery_codes_remaining: number;
  }> {
    const response = await api.get<{
      mfa_enabled: boolean;
      passkey_count?: number;
      recovery_codes_remaining: number;
    }>('/auth/mfa/status');
    return response.data;
  },

  /** The caller's passkeys, and whether they can add one on this site. */
  async listPasskeys(): Promise<PasskeyList> {
    const response = await api.get<PasskeyList>('/auth/passkeys');
    return response.data;
  },

  /** Options for creating a passkey. May ask for a step-up first. */
  async getPasskeyRegistrationOptions(): Promise<PasskeyCreationOptions> {
    const response = await api.post<PasskeyCreationOptions>('/auth/passkeys/register-options');
    return response.data;
  },

  /**
   * Save a passkey. `recovery_codes` is non-empty, and shown once, when this
   * is the member's first second factor.
   */
  async registerPasskey(name: string, credential: PasskeyRegistration): Promise<PasskeyRegisterResult> {
    const response = await api.post<PasskeyRegisterResult>('/auth/passkeys/register', { name, credential });
    return response.data;
  },

  /** Remove one of the caller's passkeys. Asks for a step-up first. */
  async deletePasskey(passkeyId: string): Promise<void> {
    await api.delete(`/auth/passkeys/${encodeURIComponent(passkeyId)}`);
  },

  /** New recovery codes, confirmed with a passkey step-up. */
  async regeneratePasskeyRecoveryCodes(): Promise<{ recovery_codes: string[] }> {
    const response = await api.post<{ recovery_codes: string[] }>('/auth/passkeys/recovery-codes');
    return response.data;
  },

  /** Org-wide MFA requirement policy (admin). */
  async getMfaPolicy(): Promise<MfaPolicy> {
    const response = await api.get<MfaPolicy>('/auth/mfa/policy');
    return response.data;
  },

  async setMfaPolicy(mfa_required: boolean, passkeys_enabled?: boolean): Promise<MfaPolicy> {
    const response = await api.put<MfaPolicy>('/auth/mfa/policy', {
      mfa_required,
      ...(passkeys_enabled === undefined ? {} : { passkeys_enabled }),
    });
    return response.data;
  },

  /**
   * Register new user
   */
  async register(data: RegisterData): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/register', data);
    return response.data;
  },

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    await api.post('/auth/logout');
    clearCache();
    clearInFlight();
  },

  /**
   * Get current user
   */
  async getCurrentUser(): Promise<CurrentUser> {
    const response = await api.get<CurrentUser>('/auth/me');
    return response.data;
  },

  /**
   * Change password
   */
  async changePassword(data: PasswordChangeData): Promise<void> {
    await api.post('/auth/change-password', data);
  },

  /**
   * Request password reset (sends email with reset link)
   */
  async requestPasswordReset(data: PasswordResetRequest, captchaToken?: string): Promise<PasswordResetRequestResponse> {
    // Header rather than body: the backend verifies the challenge in a
    // dependency, before the request body is parsed.
    const response = await api.post<PasswordResetRequestResponse>(
      '/auth/forgot-password',
      data,
      captchaToken ? { headers: { [CAPTCHA_HEADER]: captchaToken } } : {}
    );
    return response.data;
  },

  /**
   * Confirm password reset with token
   */
  async confirmPasswordReset(data: PasswordResetConfirm): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/reset-password', data);
    return response.data;
  },

  /**
   * Validate password reset token
   */
  async validateResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const response = await api.post<{ valid: boolean; email?: string }>('/auth/validate-reset-token', { token });
    return response.data;
  },

  /**
   * Check if authenticated
   */
  async checkAuth(): Promise<boolean> {
    try {
      await api.get('/auth/check');
      return true;
    } catch (_error) {
      return false;
    }
  },

  getGoogleOAuthUrl(): string {
    const baseUrl = api.defaults.baseURL || '';
    return `${baseUrl}/auth/oauth/google`;
  },

  getMicrosoftOAuthUrl(): string {
    const baseUrl = api.defaults.baseURL || '';
    return `${baseUrl}/auth/oauth/microsoft`;
  },

  getAuthentikOAuthUrl(): string {
    const baseUrl = api.defaults.baseURL || '';
    return `${baseUrl}/auth/oauth/authentik`;
  },

  /**
   * Get session settings (timeout configuration) for the current session
   */
  async getSessionSettings(): Promise<SessionSettings> {
    const response = await api.get<SessionSettings>('/auth/session-settings');
    return response.data;
  },

  /**
   * Switch the current session to (or back from) the longer kiosk limits.
   * Enabling needs the `security.kiosk_session` permission.
   */
  async setKioskSession(enabled: boolean): Promise<KioskSessionResult> {
    const response = enabled
      ? await api.post<KioskSessionResult>('/auth/session/kiosk')
      : await api.delete<KioskSessionResult>('/auth/session/kiosk');
    return response.data;
  },
};
