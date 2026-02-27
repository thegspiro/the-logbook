/**
 * Authentication Store
 *
 * Manages authentication state using Zustand.
 *
 * SEC: Auth tokens are stored exclusively in httpOnly cookies set by the
 * backend. We never store access_token or refresh_token in localStorage.
 * A lightweight `has_session` flag tells loadUser whether to attempt an
 * API call on page refresh. Legacy localStorage tokens (from older
 * versions) are cleaned up automatically.
 */

import { create } from 'zustand';
import { authService } from '../services/api';
import type { CurrentUser, LoginCredentials, RegisterData } from '../types/auth';
import { toAppError, getErrorMessage } from '../utils/errorHandling';

interface AuthState {
  user: CurrentUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
  clearError: () => void;
  checkPermission: (permission: string) => boolean;
  hasRole: (role: string) => boolean;
  hasPosition: (position: string) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,

  login: async (credentials: LoginCredentials) => {
    set({ isLoading: true, error: null });

    try {
      await authService.login(credentials);

      // SEC: Tokens are stored in httpOnly cookies by the backend response.
      // Only persist a lightweight session flag — never the actual tokens.
      localStorage.setItem('has_session', '1');

      await get().loadUser();

      set({ isLoading: false });
    } catch (err: unknown) {
      const appError = toAppError(err);
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Login failed. Please try again.'),
      });
      throw Object.assign(new Error(appError.message), appError);
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });

    try {
      await authService.register(data);

      // SEC: Tokens are stored in httpOnly cookies by the backend response.
      localStorage.setItem('has_session', '1');

      await get().loadUser();

      set({ isLoading: false });
    } catch (err: unknown) {
      const appError = toAppError(err);
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Registration failed. Please try again.'),
      });
      throw Object.assign(new Error(appError.message), appError);
    }
  },

  logout: async () => {
    try {
      await authService.logout();
    } catch {
      // Logout errors are non-critical; cookies are cleared by the backend
    } finally {
      // SEC: Clear session flag and any legacy token remnants from localStorage
      localStorage.removeItem('has_session');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      set({
        user: null,
        isAuthenticated: false,
        error: null,
      });
    }
  },

  loadUser: async () => {
    // SEC: We no longer store tokens in localStorage. The httpOnly cookie
    // is the sole auth credential. Check for a lightweight session flag
    // to decide whether to attempt an API call on page load.
    const hasSession = localStorage.getItem('has_session');

    // Clean up legacy tokens from older versions that stored them in localStorage
    const legacyToken = localStorage.getItem('access_token');
    if (legacyToken) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      // Legacy tokens imply there may be an active httpOnly cookie session
      localStorage.setItem('has_session', '1');
    }

    if (!hasSession && !legacyToken) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    set({ isLoading: true });

    try {
      const user = await authService.getCurrentUser();
      // Ensure new taxonomy fields have safe defaults for backward compatibility
      const normalizedUser: CurrentUser = {
        ...user,
        positions: user.positions ?? user.roles ?? [],
        rank: user.rank ?? null,
        membership_type: user.membership_type ?? 'member',
        must_change_password: user.must_change_password ?? false,
      };
      set({
        user: normalizedUser,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      // Not authenticated or session expired — clear session flag.
      localStorage.removeItem('has_session');
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  clearError: () => {
    set({ error: null });
  },

  checkPermission: (permission: string) => {
    const { user } = get();
    if (!user?.permissions) return false;
    // Global wildcard "*" grants all permissions (it_manager / System Owner position)
    if (user.permissions.includes('*')) return true;
    // Exact match
    if (user.permissions.includes(permission)) return true;
    // Module wildcard: "settings.*" matches "settings.manage", etc.
    if (permission.includes('.')) {
      const module = permission.split('.')[0];
      if (user.permissions.includes(`${module}.*`)) return true;
    }
    return false;
  },

  hasRole: (role: string) => {
    const { user } = get();
    return user?.roles?.includes(role) || user?.positions?.includes(role) || false;
  },

  hasPosition: (position: string) => {
    const { user } = get();
    return user?.positions?.includes(position) || false;
  },
}));
