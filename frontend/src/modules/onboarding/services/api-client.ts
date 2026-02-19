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
    configuration?: string;
    schema?: string;
    security?: {
      status: string;
      critical_issues?: number;
      warnings?: number;
    };
  };
  warnings?: string[];
  schema_error?: string;
  startup?: {
    phase: string;
    message: string;
    ready: boolean;
    detailed_message?: string;
    migrations?: {
      total: number;
      completed: number;
      current: string | null;
      progress_percent: number;
    };
    uptime_seconds: number;
    errors?: string[];
  };
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
   * Handle network-level errors from fetch (connection refused, DNS failure, etc.)
   */
  private handleNetworkError(error: unknown): { error: string; statusCode: number } {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { error: 'Request was cancelled.', statusCode: 0 };
    }

    if (error instanceof TypeError && error.message?.includes('Failed to fetch')) {
      return {
        error: 'Unable to reach the server. Please verify the backend is running and check your network connection.',
        statusCode: 0,
      };
    }

    return {
      error: 'Network error. Please check your connection and try again.',
      statusCode: 0,
    };
  }

  /**
   * Map HTTP error status codes to user-friendly messages
   */
  private handleHttpError(status: number, errorData: Record<string, unknown>): { error: string; statusCode: number } {
    const detail = (errorData.detail || errorData.message) as string | undefined;

    switch (status) {
      case 429: {
        return {
          error: 'Too many requests. Please wait a moment before trying again.',
          statusCode: 429,
        };
      }
      case 403:
        return {
          error: 'Security validation failed. Please refresh the page and try again.',
          statusCode: 403,
        };
      case 422:
        return {
          error: detail || 'Invalid data submitted. Please check your input and try again.',
          statusCode: 422,
        };
      case 409:
        return {
          error: detail || 'This record already exists. Please check for duplicates.',
          statusCode: 409,
        };
      case 500:
        return {
          error: 'A server error occurred. Please try again or check the server logs.',
          statusCode: 500,
        };
      case 503:
        return {
          error: 'The server is temporarily unavailable. It may still be starting up — please try again shortly.',
          statusCode: 503,
        };
      default:
        return {
          error: detail || 'An unexpected error occurred. Please try again.',
          statusCode: status,
        };
    }
  }

  /**
   * Make API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: Record<string, unknown>,
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
        return this.handleHttpError(response.status, errorData);
      }

      const data = await response.json();
      return {
        data: data as T,
        statusCode: response.status,
      };
    } catch (error: unknown) {
      return this.handleNetworkError(error);
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
    } catch {
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
   * Save position configuration
   * Creates positions with their permissions for the organization
   */
  async savePositionsConfig(data: {
    positions: Array<{
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
    total_positions: number;
  }>> {
    return this.request('POST', '/onboarding/session/positions', data, true);
  }

  /** @deprecated Use savePositionsConfig instead */
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
    return this.request('POST', '/onboarding/session/positions', { positions: data.roles }, true);
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
   * Create system owner (IT Manager) account
   * SECURITY CRITICAL: Password sent once via HTTPS, never stored client-side
   * Returns authentication token to log user in automatically
   */
  async createSystemOwner(data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name: string;
    last_name: string;
    badge_number?: string;
  }): Promise<ApiResponse<{ access_token?: string; refresh_token?: string }>> {
    const response = await this.request<{ access_token?: string; refresh_token?: string }>('POST', '/onboarding/system-owner', data, true);

    // SECURITY: Clear password from memory immediately
    data.password = '';
    data.password_confirm = '';

    // Store tokens using the same keys the main app auth flow expects
    // ('access_token' and 'refresh_token') so the user is seamlessly
    // authenticated after onboarding without needing to login again.
    if (response.data?.access_token) {
      localStorage.setItem('access_token', response.data.access_token);
    }
    if (response.data?.refresh_token) {
      localStorage.setItem('refresh_token', response.data.refresh_token);
    }

    return response;
  }

  /** @deprecated Use createSystemOwner instead */
  async createAdminUser(data: {
    username: string;
    email: string;
    password: string;
    password_confirm: string;
    first_name: string;
    last_name: string;
    badge_number?: string;
  }): Promise<ApiResponse<{ access_token?: string; refresh_token?: string }>> {
    return this.createSystemOwner(data);
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
