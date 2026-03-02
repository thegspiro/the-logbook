import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient BEFORE importing the service
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    defaults: { baseURL: '/api/v1' },
  },
}));

// Mock clearCache from apiCache
const mockClearCache = vi.fn();
vi.mock('../utils/apiCache', () => ({
  clearCache: () => mockClearCache() as unknown,
}));

// Import service AFTER mocks
import { authService } from './authService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authService', () => {
  // ── login ──────────────────────────────────────────────────────────
  describe('login', () => {
    it('should POST credentials to /auth/login and return token response', async () => {
      const tokenResponse = {
        access_token: 'abc123',
        refresh_token: 'ref456',
        token_type: 'bearer',
        expires_in: 3600,
      };
      mockPost.mockResolvedValue({ data: tokenResponse });

      const credentials = { username: 'admin', password: 'secret' };
      const result = await authService.login(credentials);

      expect(mockPost).toHaveBeenCalledWith('/auth/login', credentials);
      expect(result).toEqual(tokenResponse);
    });

    it('should propagate API errors', async () => {
      mockPost.mockRejectedValue(new Error('Invalid credentials'));

      await expect(authService.login({ username: 'bad', password: 'wrong' }))
        .rejects.toThrow('Invalid credentials');
    });
  });

  // ── register ───────────────────────────────────────────────────────
  describe('register', () => {
    it('should POST registration data to /auth/register and return token response', async () => {
      const tokenResponse = {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        token_type: 'bearer',
        expires_in: 3600,
      };
      mockPost.mockResolvedValue({ data: tokenResponse });

      const registerData = {
        username: 'newuser',
        email: 'new@example.com',
        password: 'StrongPass123!',
        first_name: 'John',
        last_name: 'Doe',
      };
      const result = await authService.register(registerData);

      expect(mockPost).toHaveBeenCalledWith('/auth/register', registerData);
      expect(result).toEqual(tokenResponse);
    });
  });

  // ── logout ─────────────────────────────────────────────────────────
  describe('logout', () => {
    it('should POST to /auth/logout and clear the cache', async () => {
      mockPost.mockResolvedValue({ data: {} });

      await authService.logout();

      expect(mockPost).toHaveBeenCalledWith('/auth/logout');
      expect(mockClearCache).toHaveBeenCalledOnce();
    });

    it('should clear the cache even after successful logout', async () => {
      mockPost.mockResolvedValue({ data: undefined });

      await authService.logout();

      expect(mockClearCache).toHaveBeenCalledOnce();
    });
  });

  // ── getCurrentUser ─────────────────────────────────────────────────
  describe('getCurrentUser', () => {
    it('should GET /auth/me and return the current user', async () => {
      const currentUser = {
        id: 'user-1',
        username: 'admin',
        email: 'admin@example.com',
        organization_id: 'org-1',
        timezone: 'America/New_York',
        roles: ['admin'],
        positions: ['Chief'],
        rank: 'Captain',
        membership_type: 'active',
        permissions: ['events.view', 'events.manage'],
        is_active: true,
        email_verified: true,
        mfa_enabled: false,
        password_expired: false,
        must_change_password: false,
      };
      mockGet.mockResolvedValue({ data: currentUser });

      const result = await authService.getCurrentUser();

      expect(mockGet).toHaveBeenCalledWith('/auth/me');
      expect(result).toEqual(currentUser);
    });
  });

  // ── changePassword ─────────────────────────────────────────────────
  describe('changePassword', () => {
    it('should POST password change data to /auth/change-password', async () => {
      mockPost.mockResolvedValue({ data: undefined });

      const data = { current_password: 'old', new_password: 'new123!' };
      await authService.changePassword(data);

      expect(mockPost).toHaveBeenCalledWith('/auth/change-password', data);
    });

    it('should propagate errors for wrong current password', async () => {
      mockPost.mockRejectedValue(new Error('Current password is incorrect'));

      await expect(
        authService.changePassword({ current_password: 'wrong', new_password: 'new' })
      ).rejects.toThrow('Current password is incorrect');
    });
  });

  // ── requestPasswordReset ───────────────────────────────────────────
  describe('requestPasswordReset', () => {
    it('should POST email to /auth/forgot-password and return message', async () => {
      const response = { message: 'Password reset email sent' };
      mockPost.mockResolvedValue({ data: response });

      const result = await authService.requestPasswordReset({ email: 'user@example.com' });

      expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'user@example.com' });
      expect(result).toEqual(response);
    });
  });

  // ── confirmPasswordReset ───────────────────────────────────────────
  describe('confirmPasswordReset', () => {
    it('should POST token and new password to /auth/reset-password', async () => {
      const response = { message: 'Password has been reset' };
      mockPost.mockResolvedValue({ data: response });

      const data = { token: 'reset-token-xyz', new_password: 'NewPass123!' };
      const result = await authService.confirmPasswordReset(data);

      expect(mockPost).toHaveBeenCalledWith('/auth/reset-password', data);
      expect(result).toEqual(response);
    });
  });

  // ── validateResetToken ─────────────────────────────────────────────
  describe('validateResetToken', () => {
    it('should POST the token to /auth/validate-reset-token and return validity', async () => {
      const response = { valid: true, email: 'user@example.com' };
      mockPost.mockResolvedValue({ data: response });

      const result = await authService.validateResetToken('some-token');

      expect(mockPost).toHaveBeenCalledWith('/auth/validate-reset-token', { token: 'some-token' });
      expect(result).toEqual(response);
    });

    it('should return invalid when the token is expired', async () => {
      const response = { valid: false };
      mockPost.mockResolvedValue({ data: response });

      const result = await authService.validateResetToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.email).toBeUndefined();
    });
  });

  // ── checkAuth ──────────────────────────────────────────────────────
  describe('checkAuth', () => {
    it('should return true when /auth/check succeeds', async () => {
      mockGet.mockResolvedValue({ data: {} });

      const result = await authService.checkAuth();

      expect(mockGet).toHaveBeenCalledWith('/auth/check');
      expect(result).toBe(true);
    });

    it('should return false when /auth/check fails (not authenticated)', async () => {
      mockGet.mockRejectedValue(new Error('Unauthorized'));

      const result = await authService.checkAuth();

      expect(result).toBe(false);
    });
  });

  // ── getGoogleOAuthUrl ──────────────────────────────────────────────
  describe('getGoogleOAuthUrl', () => {
    it('should return the Google OAuth URL using baseURL', () => {
      const url = authService.getGoogleOAuthUrl();

      expect(url).toBe('/api/v1/auth/oauth/google');
    });
  });

  // ── getMicrosoftOAuthUrl ───────────────────────────────────────────
  describe('getMicrosoftOAuthUrl', () => {
    it('should return the Microsoft OAuth URL using baseURL', () => {
      const url = authService.getMicrosoftOAuthUrl();

      expect(url).toBe('/api/v1/auth/oauth/microsoft');
    });
  });

  // ── getSessionSettings ─────────────────────────────────────────────
  describe('getSessionSettings', () => {
    it('should GET /auth/session-settings and return settings', async () => {
      const settings = { session_timeout_minutes: 30 };
      mockGet.mockResolvedValue({ data: settings });

      const result = await authService.getSessionSettings();

      expect(mockGet).toHaveBeenCalledWith('/auth/session-settings');
      expect(result).toEqual(settings);
    });

    it('should handle empty session timeout', async () => {
      const settings = {};
      mockGet.mockResolvedValue({ data: settings });

      const result = await authService.getSessionSettings();

      expect(result.session_timeout_minutes).toBeUndefined();
    });
  });
});
