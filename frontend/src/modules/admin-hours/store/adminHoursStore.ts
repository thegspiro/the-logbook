/**
 * Admin Hours Zustand Store
 */

import { create } from 'zustand';
import { adminHoursCategoryService, adminHoursClockService, adminHoursEntryService } from '../services/api';
import type {
  AdminHoursCategory,
  AdminHoursCategoryCreate,
  AdminHoursCategoryUpdate,
  AdminHoursEntry,
  AdminHoursActiveSession,
  AdminHoursSummary,
} from '../types';

interface AdminHoursState {
  // Categories
  categories: AdminHoursCategory[];
  categoriesLoading: boolean;

  // Entries
  myEntries: AdminHoursEntry[];
  myEntriesTotal: number;
  allEntries: AdminHoursEntry[];
  allEntriesTotal: number;
  entriesLoading: boolean;

  // Active session
  activeSession: AdminHoursActiveSession | null;
  activeSessionLoading: boolean;

  // Summary
  summary: AdminHoursSummary | null;

  // Pending count (for badge)
  pendingCount: number;

  // General
  error: string | null;

  // Category actions
  fetchCategories: (includeInactive?: boolean) => Promise<void>;
  createCategory: (data: AdminHoursCategoryCreate) => Promise<AdminHoursCategory>;
  updateCategory: (id: string, data: AdminHoursCategoryUpdate) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;

  // Clock actions
  clockIn: (categoryId: string) => Promise<void>;
  clockOut: (entryId: string) => Promise<void>;
  clockOutByCategory: (categoryId: string) => Promise<void>;
  fetchActiveSession: () => Promise<void>;

  // Entry actions
  fetchMyEntries: (params?: {
    status?: string;
    categoryId?: string;
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }) => Promise<void>;
  fetchAllEntries: (params?: {
    status?: string;
    categoryId?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    skip?: number;
    limit?: number;
  }) => Promise<void>;
  reviewEntry: (entryId: string, action: 'approve' | 'reject', reason?: string) => Promise<void>;
  bulkApprove: (entryIds: string[]) => Promise<number>;
  fetchSummary: (params?: { userId?: string; startDate?: string; endDate?: string }) => Promise<void>;
  fetchPendingCount: () => Promise<void>;

  clearError: () => void;
}

export const useAdminHoursStore = create<AdminHoursState>((set, get) => ({
  categories: [],
  categoriesLoading: false,
  myEntries: [],
  myEntriesTotal: 0,
  allEntries: [],
  allEntriesTotal: 0,
  entriesLoading: false,
  activeSession: null,
  activeSessionLoading: false,
  summary: null,
  pendingCount: 0,
  error: null,

  // =========================================================================
  // Categories
  // =========================================================================

  fetchCategories: async (includeInactive = false) => {
    set({ categoriesLoading: true, error: null });
    try {
      const categories = await adminHoursCategoryService.list({ includeInactive });
      set({ categories, categoriesLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load categories',
        categoriesLoading: false,
      });
    }
  },

  createCategory: async (data) => {
    set({ error: null });
    try {
      const category = await adminHoursCategoryService.create(data);
      await get().fetchCategories(true);
      return category;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to create category';
      set({ error: msg });
      throw error;
    }
  },

  updateCategory: async (id, data) => {
    set({ error: null });
    try {
      await adminHoursCategoryService.update(id, data);
      await get().fetchCategories(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to update category' });
      throw error;
    }
  },

  deleteCategory: async (id) => {
    set({ error: null });
    try {
      await adminHoursCategoryService.delete(id);
      await get().fetchCategories(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to delete category' });
      throw error;
    }
  },

  // =========================================================================
  // Clock In / Clock Out
  // =========================================================================

  clockIn: async (categoryId) => {
    set({ error: null });
    try {
      await adminHoursClockService.clockIn(categoryId);
      await get().fetchActiveSession();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to clock in' });
      throw error;
    }
  },

  clockOut: async (entryId) => {
    set({ error: null });
    try {
      await adminHoursClockService.clockOut(entryId);
      set({ activeSession: null });
      await get().fetchMyEntries();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to clock out' });
      throw error;
    }
  },

  clockOutByCategory: async (categoryId) => {
    set({ error: null });
    try {
      await adminHoursClockService.clockOutByCategory(categoryId);
      set({ activeSession: null });
      await get().fetchMyEntries();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to clock out' });
      throw error;
    }
  },

  fetchActiveSession: async () => {
    set({ activeSessionLoading: true });
    try {
      const session = await adminHoursClockService.getActiveSession();
      set({ activeSession: session, activeSessionLoading: false });
    } catch {
      set({ activeSession: null, activeSessionLoading: false });
    }
  },

  // =========================================================================
  // Entries
  // =========================================================================

  fetchMyEntries: async (params) => {
    set({ entriesLoading: true, error: null });
    try {
      const result = await adminHoursEntryService.listMy(params);
      set({ myEntries: result.entries, myEntriesTotal: result.total, entriesLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load entries',
        entriesLoading: false,
      });
    }
  },

  fetchAllEntries: async (params) => {
    set({ entriesLoading: true, error: null });
    try {
      const result = await adminHoursEntryService.listAll(params);
      set({ allEntries: result.entries, allEntriesTotal: result.total, entriesLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to load entries',
        entriesLoading: false,
      });
    }
  },

  reviewEntry: async (entryId, action, reason) => {
    set({ error: null });
    try {
      await adminHoursEntryService.review(entryId, action, reason);
      await get().fetchAllEntries({ status: 'pending' });
      await get().fetchPendingCount();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to review entry' });
      throw error;
    }
  },

  bulkApprove: async (entryIds) => {
    set({ error: null });
    try {
      const result = await adminHoursEntryService.bulkApprove(entryIds);
      await get().fetchAllEntries({ status: 'pending' });
      await get().fetchPendingCount();
      return result.approvedCount;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to bulk approve' });
      throw error;
    }
  },

  fetchSummary: async (params) => {
    set({ error: null });
    try {
      const summary = await adminHoursEntryService.getSummary(params);
      set({ summary });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Failed to load summary' });
    }
  },

  fetchPendingCount: async () => {
    try {
      const count = await adminHoursEntryService.getPendingCount();
      set({ pendingCount: count });
    } catch {
      // silently fail - badge count is non-critical
    }
  },

  clearError: () => set({ error: null }),
}));
