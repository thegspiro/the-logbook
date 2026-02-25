/**
 * Authentication Store
 *
 * Manages authentication state using Zustand
 */

import { create } from 'zustand';
import { decodeJwt } from 'jose';
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
      const tokenResponse = await authService.login(credentials);

      // Persist tokens so ProtectedRoute can restore the session on refresh.
      localStorage.setItem('access_token', tokenResponse.access_token);
      localStorage.setItem('refresh_token', tokenResponse.refresh_token);

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
      const tokenResponse = await authService.register(data);

      localStorage.setItem('access_token', tokenResponse.access_token);
      localStorage.setItem('refresh_token', tokenResponse.refresh_token);

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
      // Clear localStorage tokens
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
    const token = localStorage.getItem('access_token');

    // No stored token — nothing to restore.
    if (!token) {
      set({ user: null, isAuthenticated: false, isLoading: false });
      return;
    }

    // Quick client-side expiry check to avoid a needless API round-trip.
    try {
      const { exp } = decodeJwt(token);
      if (typeof exp === 'number' && exp < Math.floor(Date.now() / 1000)) {
        // Token expired — clear stored tokens and bail out.
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
    } catch {
      // Token is opaque or malformed — let the API decide.
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
      // Not authenticated or session expired — clear stored tokens.
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
