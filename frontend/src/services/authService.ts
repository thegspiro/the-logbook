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
