/**
 * Secure API Client for Onboarding Module
 *
 * SECURITY: Handles server-side sessions, CSRF tokens, and rate limiting
 */

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

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  environment: string;
  timestamp: string;
  checks: {
    database: string;
    redis: string;
    configuration: string;
  };
  warnings?: string[];
}

class SecureApiClient {
  private baseUrl: string;
  private sessionId: string | null = null;
  private csrfToken: string | null = null;

  constructor() {
    this.baseUrl = import.meta.env.VITE_API_URL || '/api/v1';
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
   * Check backend health status
   * Returns status of database, redis, and configuration
   */
  async checkHealth(): Promise<ApiResponse<HealthStatus>> {
    try {
      // Health endpoint is at root, not under /api/v1
      const baseUrl = this.baseUrl.replace('/api/v1', '');
      const url = `${baseUrl}/health`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        return {
          error: 'Health check failed',
          statusCode: response.status,
        };
      }

      const data = await response.json();
      return {
        data: data as HealthStatus,
        statusCode: response.status,
      };
    } catch (error: any) {
      return {
        error: 'Unable to connect to backend',
        statusCode: 0,
      };
    }
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
   * Test email connection
   * Tests the email configuration without saving it
   * Returns success/failure and error details
   * TODO: Backend endpoint needs to be implemented at /onboarding/test/email
   */
  async testEmailConnection(data: {
    platform: string;
    config: Record<string, any>;
  }): Promise<ApiResponse<{ success: boolean; message?: string }>> {
    return this.request('POST', '/onboarding/test/email', data, true);
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
   * Save role configuration
   * Creates roles with their permissions for the organization
   */
  async saveRolesConfig(data: {
    roles: Array<{
      id: string;
      name: string;
      description?: string;
      priority: number;
      permissions: Record<string, { view: boolean; manage: boolean }>;
      is_custom?: boolean;
    }>;
  }): Promise<ApiResponse<{
    success: boolean;
    message: string;
    created: string[];
    updated: string[];
    total_roles: number;
  }>> {
    return this.request('POST', '/onboarding/session/roles', data, true);
  }

  /**
   * Create organization (legacy simple method)
   * Creates the first organization during onboarding with default roles
   */
  async createOrganization(data: {
    name: string;
    slug: string;
    organization_type?: string;
    description?: string;
    timezone?: string;
  }): Promise<ApiResponse<any>> {
    return this.request('POST', '/onboarding/organization', {
      name: data.name,
      slug: data.slug,
      organization_type: data.organization_type || 'fire_department',
      description: data.description,
      timezone: data.timezone || 'America/New_York'
    }, true);
  }

  /**
   * Save organization with comprehensive details (Step 1)
   * Creates the organization during onboarding and commits to database immediately
   */
  async saveOrganization(data: {
    name: string;
    slug?: string;
    description?: string;
    organization_type: 'fire_department' | 'ems_only' | 'fire_ems_combined';
    timezone: string;
    phone?: string;
    fax?: string;
    email?: string;
    website?: string;
    mailing_address: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip_code: string;
      country?: string;
    };
    physical_address_same: boolean;
    physical_address?: {
      line1: string;
      line2?: string;
      city: string;
      state: string;
      zip_code: string;
      country?: string;
    };
    identifier_type: 'fdid' | 'state_id' | 'department_id';
    fdid?: string;
    state_id?: string;
    department_id?: string;
    county?: string;
    founded_year?: number;
    tax_id?: string;
    logo?: string;
  }): Promise<ApiResponse<{
    id: string;
    name: string;
    slug: string;
    organization_type: string;
    timezone: string;
    active: boolean;
    created_at: string;
  }>> {
    return this.request('POST', '/onboarding/session/organization', data, true);
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
  }): Promise<ApiResponse<{ access_token?: string }>> {
    const response = await this.request<{ access_token?: string }>('POST', '/onboarding/admin-user', data, true);

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

  /**
   * Reset onboarding - clears all database records and resets to initial state
   * WARNING: This is destructive and cannot be undone
   */
  async resetOnboarding(): Promise<ApiResponse<any>> {
    const response = await this.request('POST', '/onboarding/reset', {}, true);

    if (response.statusCode === 200 || response.statusCode === 201) {
      this.clearSession();
    }

    return response;
  }
}

// Export singleton instance
export const apiClient = new SecureApiClient();

// Export types
export type { ApiResponse, OnboardingSession, RateLimitError, HealthStatus };
