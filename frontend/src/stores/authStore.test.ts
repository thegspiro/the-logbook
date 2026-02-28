import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';

// ---- Mocks (must be declared before importing the store) ----

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockLogout = vi.fn();
const mockGetCurrentUser = vi.fn();

vi.mock('../services/api', () => ({
  authService: {
    login: (...args: unknown[]) => mockLogin(...args) as unknown,
    register: (...args: unknown[]) => mockRegister(...args) as unknown,
    logout: (...args: unknown[]) => mockLogout(...args) as unknown,
    getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args) as unknown,
  },
}));

// ---- Import store AFTER mocks are in place ----
import { useAuthStore } from './authStore';

// ---- Helpers ----

function getState() {
  return useAuthStore.getState();
}

const fakeUser = {
  id: 'u1',
  username: 'testuser',
  email: 'test@example.com',
  first_name: 'Test',
  last_name: 'User',
  full_name: 'Test User',
  organization_id: 'org1',
  timezone: 'UTC',
  roles: ['member'],
  positions: ['member'],
  rank: null,
  membership_type: 'member',
  permissions: ['events.view', 'settings.*'],
  is_active: true,
  email_verified: true,
  mfa_enabled: false,
  password_expired: false,
  must_change_password: false,
};

// ---- Tests ----

describe('authStore', () => {
  beforeEach(() => {
    // Reset the store to its initial state between tests
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });

    // Clear all mocks
    vi.clearAllMocks();

    // Clear localStorage
    localStorage.clear();
  });

  // ---- Initial State ----

  describe('initial state', () => {
    it('is unauthenticated with no user, no error, and not loading', () => {
      const state = getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // ---- login ----

  describe('login', () => {
    it('sets has_session flag and calls loadUser on success', async () => {
      mockLogin.mockResolvedValue(undefined);
      mockGetCurrentUser.mockResolvedValue(fakeUser);

      await act(async () => {
        await getState().login({ username: 'testuser', password: 'password123' });
      });

      expect(mockLogin).toHaveBeenCalledWith({ username: 'testuser', password: 'password123' });
      expect(localStorage.getItem('has_session')).toBe('1');
      expect(mockGetCurrentUser).toHaveBeenCalled();

      const state = getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).not.toBeNull();
      expect(state.user?.username).toBe('testuser');
      expect(state.isLoading).toBe(false);
    });

    it('does not store tokens in localStorage', async () => {
      mockLogin.mockResolvedValue(undefined);
      mockGetCurrentUser.mockResolvedValue(fakeUser);

      await act(async () => {
        await getState().login({ username: 'testuser', password: 'password123' });
      });

      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
    });

    it('sets error on failure and re-throws', async () => {
      mockLogin.mockRejectedValue(new Error('Invalid credentials'));

      await expect(
        act(async () => {
          await getState().login({ username: 'bad', password: 'wrong' });
        }),
      ).rejects.toBeDefined();

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Invalid credentials');
      expect(state.isAuthenticated).toBe(false);
    });
  });

  // ---- register ----

  describe('register', () => {
    it('sets has_session flag and loads user on success', async () => {
      mockRegister.mockResolvedValue(undefined);
      mockGetCurrentUser.mockResolvedValue(fakeUser);

      await act(async () => {
        await getState().register({
          username: 'newuser',
          email: 'new@example.com',
          password: 'securePass1',
          first_name: 'New',
          last_name: 'User',
        });
      });

      expect(mockRegister).toHaveBeenCalled();
      expect(localStorage.getItem('has_session')).toBe('1');
      expect(getState().isAuthenticated).toBe(true);
    });

    it('sets error on failure and re-throws', async () => {
      mockRegister.mockRejectedValue(new Error('Email already taken'));

      await expect(
        act(async () => {
          await getState().register({
            username: 'dup',
            email: 'dup@example.com',
            password: 'pass',
            first_name: 'D',
            last_name: 'U',
          });
        }),
      ).rejects.toBeDefined();

      expect(getState().error).toBe('Email already taken');
    });
  });

  // ---- logout ----

  describe('logout', () => {
    it('calls authService.logout, clears localStorage flags, and resets state', async () => {
      localStorage.setItem('has_session', '1');
      useAuthStore.setState({ user: fakeUser, isAuthenticated: true });

      mockLogout.mockResolvedValue(undefined);

      await act(async () => {
        await getState().logout();
      });

      expect(mockLogout).toHaveBeenCalled();
      expect(localStorage.getItem('has_session')).toBeNull();
      // Legacy tokens are also cleaned up
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();

      const state = getState();
      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBeNull();
    });

    it('clears session even when authService.logout throws', async () => {
      localStorage.setItem('has_session', '1');
      useAuthStore.setState({ user: fakeUser, isAuthenticated: true });

      mockLogout.mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await getState().logout();
      });

      expect(localStorage.getItem('has_session')).toBeNull();
      expect(getState().isAuthenticated).toBe(false);
    });
  });

  // ---- loadUser ----

  describe('loadUser', () => {
    it('returns early and sets unauthenticated when no session flag', async () => {
      await act(async () => {
        await getState().loadUser();
      });

      expect(mockGetCurrentUser).not.toHaveBeenCalled();
      expect(getState().isAuthenticated).toBe(false);
      expect(getState().user).toBeNull();
    });

    it('fetches user data when has_session flag is set', async () => {
      localStorage.setItem('has_session', '1');
      mockGetCurrentUser.mockResolvedValue(fakeUser);

      await act(async () => {
        await getState().loadUser();
      });

      expect(mockGetCurrentUser).toHaveBeenCalled();

      const state = getState();
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).not.toBeNull();
      expect(state.user?.id).toBe('u1');
      expect(state.isLoading).toBe(false);
    });

    it('migrates legacy access_token to has_session flag', async () => {
      localStorage.setItem('access_token', 'legacy-token');
      localStorage.setItem('refresh_token', 'legacy-refresh');
      mockGetCurrentUser.mockResolvedValue(fakeUser);

      await act(async () => {
        await getState().loadUser();
      });

      // Legacy tokens cleaned up
      expect(localStorage.getItem('access_token')).toBeNull();
      expect(localStorage.getItem('refresh_token')).toBeNull();
      // Session flag set for migration
      expect(localStorage.getItem('has_session')).toBe('1');
      // User loaded successfully
      expect(mockGetCurrentUser).toHaveBeenCalled();
      expect(getState().isAuthenticated).toBe(true);
    });

    it('clears session when getCurrentUser fails', async () => {
      localStorage.setItem('has_session', '1');
      mockGetCurrentUser.mockRejectedValue(new Error('Unauthorized'));

      await act(async () => {
        await getState().loadUser();
      });

      expect(localStorage.getItem('has_session')).toBeNull();
      expect(getState().isAuthenticated).toBe(false);
      expect(getState().user).toBeNull();
    });
  });

  // ---- checkPermission ----

  describe('checkPermission', () => {
    it('returns false when user is null', () => {
      expect(getState().checkPermission('events.view')).toBe(false);
    });

    it('returns true for global wildcard "*"', () => {
      useAuthStore.setState({ user: { ...fakeUser, permissions: ['*'] } });
      expect(getState().checkPermission('anything.here')).toBe(true);
    });

    it('returns true for module wildcard (e.g. "settings.*" matches "settings.manage")', () => {
      useAuthStore.setState({ user: { ...fakeUser, permissions: ['settings.*'] } });
      expect(getState().checkPermission('settings.manage')).toBe(true);
      expect(getState().checkPermission('settings.view')).toBe(true);
    });

    it('returns true for exact match', () => {
      useAuthStore.setState({ user: { ...fakeUser, permissions: ['events.view'] } });
      expect(getState().checkPermission('events.view')).toBe(true);
    });

    it('returns false when permission does not match', () => {
      useAuthStore.setState({ user: { ...fakeUser, permissions: ['events.view'] } });
      expect(getState().checkPermission('events.edit')).toBe(false);
    });

    it('returns false when user has no permissions array', () => {
      useAuthStore.setState({
        user: { ...fakeUser, permissions: undefined } as unknown as typeof fakeUser,
      });
      expect(getState().checkPermission('events.view')).toBe(false);
    });

    it('module wildcard does not match permissions without a dot', () => {
      useAuthStore.setState({ user: { ...fakeUser, permissions: ['settings.*'] } });
      expect(getState().checkPermission('admin')).toBe(false);
    });
  });

  // ---- hasRole ----

  describe('hasRole', () => {
    it('returns true when role is in roles array', () => {
      useAuthStore.setState({ user: { ...fakeUser, roles: ['admin', 'member'], positions: [] } });
      expect(getState().hasRole('admin')).toBe(true);
    });

    it('returns true when role is in positions array', () => {
      useAuthStore.setState({ user: { ...fakeUser, roles: [], positions: ['captain'] } });
      expect(getState().hasRole('captain')).toBe(true);
    });

    it('returns false when role is in neither array', () => {
      useAuthStore.setState({ user: { ...fakeUser, roles: ['member'], positions: ['member'] } });
      expect(getState().hasRole('admin')).toBe(false);
    });

    it('returns false when user is null', () => {
      expect(getState().hasRole('admin')).toBe(false);
    });
  });

  // ---- hasPosition ----

  describe('hasPosition', () => {
    it('returns true when position is found', () => {
      useAuthStore.setState({ user: { ...fakeUser, positions: ['captain', 'lieutenant'] } });
      expect(getState().hasPosition('captain')).toBe(true);
    });

    it('returns false when position is not found', () => {
      useAuthStore.setState({ user: { ...fakeUser, positions: ['member'] } });
      expect(getState().hasPosition('captain')).toBe(false);
    });

    it('returns false when user is null', () => {
      expect(getState().hasPosition('captain')).toBe(false);
    });
  });

  // ---- clearError ----

  describe('clearError', () => {
    it('sets error to null', () => {
      useAuthStore.setState({ error: 'Something bad' });
      getState().clearError();
      expect(getState().error).toBeNull();
    });
  });
});
