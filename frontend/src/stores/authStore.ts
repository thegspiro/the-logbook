/**
 * Authentication Store
 *
 * Manages authentication state using Zustand
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
      const response = await authService.login(credentials);

      // Store tokens
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('refresh_token', response.refresh_token);

      // Load user data
      await get().loadUser();

      set({ isLoading: false });
    } catch (err: unknown) {
      const error = toAppError(err);
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Login failed. Please try again.'),
      });
      throw error;
    }
  },

  register: async (data: RegisterData) => {
    set({ isLoading: true, error: null });

    try {
      const response = await authService.register(data);

      // Store tokens
      localStorage.setItem('access_token', response.access_token);
      localStorage.setItem('refresh_token', response.refresh_token);

      // Load user data
      await get().loadUser();

      set({ isLoading: false });
    } catch (err: unknown) {
      const error = toAppError(err);
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Registration failed. Please try again.'),
      });
      throw error;
    }
  },

  logout: async () => {
    try {
      await authService.logout();
    } catch (error) {
      // Logout errors are non-critical; tokens are cleared regardless
    } finally {
      // Clear tokens and user data
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

    if (!token) {
      set({ isAuthenticated: false, user: null });
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
      };
      set({
        user: normalizedUser,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      // Clear invalid tokens
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
    return user?.roles.includes(role) || user?.positions?.includes(role) || false;
  },

  hasPosition: (position: string) => {
    const { user } = get();
    return user?.positions?.includes(position) || false;
  },
}));
