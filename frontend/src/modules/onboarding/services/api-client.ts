/**
 * Secure API Client for Onboarding Module
 *
 * SECURITY: Handles server-side sessions, CSRF tokens, and rate limiting
 */

import { generateSecureToken } from '../utils/security';

interface ApiResponse<T> {
  data?: T;
  error?: string;
  statusCode: number;
}

interface OnboardingSession {
  session_id: string;
  expires_at: string;
}

interface RateLimitError {
  message: string;
  retry_after?: number;
}

class SecureApiClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private csrfToken: string | null = null;

  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
    this.loadSession();
  }

  /**
   * Load session from localStorage (NOT sessionStorage for persistence across tabs)
   * SECURITY: Only session ID stored, not sensitive data
   */
  private loadSession(): void {
    this.sessionId = localStorage.getItem('onboarding_session_id');
    this.csrfToken = localStorage.getItem('csrf_token');
  }

  /**
   * Save session to localStorage
   */
  private saveSession(sessionId: string, csrfToken?: string): void {
    this.sessionId = sessionId;
    localStorage.setItem('onboarding_session_id', sessionId);

    if (csrfToken) {
      this.csrfToken = csrfToken;
      localStorage.setItem('csrf_token', csrfToken);
    }
  }

  /**
   * Clear session
   */
  clearSession(): void {
    this.sessionId = null;
    this.csrfToken = null;
    localStorage.removeItem('onboarding_session_id');
    localStorage.removeItem('csrf_token');
    localStorage.removeItem('onboarding_data');
  }

  /**
   * Get headers for API request
   */
  private getHeaders(includeCSRF: boolean = false): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (this.sessionId) {
      headers['X-Session-ID'] = this.sessionId;
    }

    if (includeCSRF && this.csrfToken) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    return headers;
  }

  /**
   * Handle API errors
   */
  private handleError(error: any): { error: string; statusCode: number } {
    if (error.response) {
      // Rate limiting
      if (error.response.status === 429) {
        const retryAfter = error.response.headers?.['Retry-After'];
        const message = retryAfter
          ? `Too many requests. Please try again in ${retryAfter} seconds.`
          : 'Too many requests. Please wait before trying again.';
        return { error: message, statusCode: 429 };
      }

      // CSRF error
      if (error.response.status === 403) {
        return { error: 'Security validation failed. Please refresh and try again.', statusCode: 403 };
      }

      // Other errors
      return {
        error: error.response.data?.detail || error.response.data?.message || 'An error occurred',
        statusCode: error.response.status,
      };
    }

    // Network error
    return {
      error: 'Network error. Please check your connection.',
      statusCode: 0,
    };
  }

  /**
   * Make API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: any,
    requiresCSRF: boolean = false
  ): Promise<ApiResponse<T>> {
    try {
      const url = `${this.baseUrl}${endpoint}`;
      const headers = this.getHeaders(requiresCSRF);

      const options: RequestInit = {
        method,
        headers,
        credentials: 'include', // Include cookies for session management
      };

      if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);

      // Update CSRF token if provided
      const newCsrfToken = response.headers.get('X-CSRF-Token');
      if (newCsrfToken) {
        this.csrfToken = newCsrfToken;
        localStorage.setItem('csrf_token', newCsrfToken);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        return {
          error: errorData.detail || errorData.message || 'Request failed',
          statusCode: response.status,
        };
      }

      const data = await response.json();
      return {
        data: data as T,
        statusCode: response.status,
      };
    } catch (error: any) {
      return this.handleError(error);
    }
  }

  /**
   * Start onboarding session
   */
  async startSession(): Promise<ApiResponse<OnboardingSession>> {
    const response = await this.request<OnboardingSession>('POST', '/onboarding/start');

    if (response.data) {
      this.saveSession(response.data.session_id);
    }

    return response;
  }

  /**
   * Get onboarding status
   */
  async getStatus(): Promise<ApiResponse<any>> {
    return this.request('GET', '/onboarding/status');
  }

  /**
   * Save department info
   * SECURITY: Logo is safe to store (base64 image, no secrets)
   */
  async saveDepartmentInfo(data: {
    name: string;
    logo?: string;
    navigation_layout: 'top' | 'left';
  }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/department', data, true);
  }

  /**
   * Save email configuration
   * SECURITY: Sensitive fields (secrets, passwords) sent to server, NOT stored client-side
   */
  async saveEmailConfig(data: {
    platform: string;
    config: Record<string, any>;
  }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/email', data, true);
  }

  /**
   * Save file storage configuration
   * SECURITY: API keys and secrets sent to server
   */
  async saveFileStorageConfig(data: {
    platform: string;
    config: Record<string, any>;
  }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/file-storage', data, true);
  }

  /**
   * Save authentication platform
   */
  async saveAuthPlatform(platform: string): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/auth', { platform }, true);
  }

  /**
   * Save IT team information
   */
  async saveITTeam(data: {
    it_team: Array<{
      name: string;
      email: string;
      phone: string;
      role: string;
    }>;
    backup_access: {
      email: string;
      phone: string;
      secondary_admin_email?: string;
    };
  }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/it-team', data, true);
  }

  /**
   * Save module configuration
   * Stores which modules are enabled for the department
   */
  async saveModuleConfig(data: { modules: string[] }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/session/modules', data, true);
  }

  /**
   * Create admin user
   * SECURITY CRITICAL: Password sent once via HTTPS, never stored client-side
   * Returns authentication token to log user in automatically
   */
  async createAdminUser(data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name: string;
    last_name: string;
    badge_number?: string;
  }): Promise<ApiResponse<any>> {
    const response = await this.request('POST', '/onboarding/admin-user', data, true);

    // SECURITY: Clear password from memory immediately
    data.password = '';
    data.password_confirm = '';

    // If successful, store auth token (backend should set httpOnly cookie)
    // The token will be used for subsequent authenticated requests
    if (response.data?.access_token) {
      // SECURITY: Backend should set httpOnly cookie for token
      // If token is returned in response body, store it temporarily
      // (This is a fallback - httpOnly cookies are preferred)
      localStorage.setItem('auth_token', response.data.access_token);
    }

    return response;
  }

  /**
   * Complete onboarding and finalize setup
   * Clears onboarding session and prepares for main app access
   */
  async completeOnboarding(): Promise<ApiResponse<any>> {
    const response = await this.request('POST', '/onboarding/complete', {}, true);

    // Clear onboarding session after completion
    if (response.statusCode === 200 || response.statusCode === 201) {
      this.clearSession();
      // Keep auth token - user is now logged in
    }

    return response;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if session exists
   */
  hasSession(): boolean {
    return !!this.sessionId;
  }
}

// Export singleton instance
export const apiClient = new SecureApiClient();

// Export types
export type { ApiResponse, OnboardingSession, RateLimitError };
