/**
 * authService — extracted from services/api.ts
 */

import api from './apiClient';
import { clearCache } from '../utils/apiCache';
import type { CurrentUser, LoginCredentials, PasswordChangeData, PasswordResetConfirm, PasswordResetRequest, RegisterData, TokenResponse } from '../types/auth';

export const authService = {
  /**
   * Login user
   */
  async login(credentials: LoginCredentials): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/login', credentials);
    return response.data;
  },

  /**
   * Complete an MFA-gated login with a TOTP code or a recovery code.
   */
  async mfaLogin(payload: {
    temp_token: string;
    code?: string;
    recovery_code?: string;
  }): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>('/auth/mfa/login', payload);
    return response.data;
  },

  /**
   * Begin MFA enrollment: returns the secret + otpauth provisioning URI.
   */
  async setupMfa(): Promise<{ secret: string; qr_code_url: string }> {
    const response = await api.post<{ secret: string; qr_code_url: string }>(
      '/auth/mfa/setup',
    );
    return response.data;
  },

  /**
   * Confirm enrollment with a code; returns one-time recovery codes.
   */
  async verifyMfaSetup(code: string): Promise<{ recovery_codes: string[] }> {
    const response = await api.post<{ recovery_codes: string[] }>(
      '/auth/mfa/verify-setup',
      { code },
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

  /** Current user's MFA status. */
  async getMfaStatus(): Promise<{
    mfa_enabled: boolean;
    recovery_codes_remaining: number;
  }> {
    const response = await api.get<{
      mfa_enabled: boolean;
      recovery_codes_remaining: number;
    }>('/auth/mfa/status');
    return response.data;
  },

  /** Org-wide MFA requirement policy (admin). */
  async getMfaPolicy(): Promise<{ mfa_required: boolean }> {
    const response = await api.get<{ mfa_required: boolean }>('/auth/mfa/policy');
    return response.data;
  },

  async setMfaPolicy(mfa_required: boolean): Promise<{ mfa_required: boolean }> {
    const response = await api.put<{ mfa_required: boolean }>('/auth/mfa/policy', {
      mfa_required,
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
  async requestPasswordReset(data: PasswordResetRequest): Promise<{ message: string }> {
    const response = await api.post<{ message: string }>('/auth/forgot-password', data);
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

  /**
   * Get session settings (timeout configuration)
   */
  async getSessionSettings(): Promise<{ session_timeout_minutes?: number }> {
    const response = await api.get<{ session_timeout_minutes?: number }>('/auth/session-settings');
    return response.data;
  },
};
