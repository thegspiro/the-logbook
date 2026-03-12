/**
 * Minutes Module — Zustand Store
 *
 * Manages minutes list state, stats, loading, and errors.
 */

import { create } from 'zustand';
import { handleStoreError } from '../../../utils/storeHelpers';
import { minutesService } from '../services/api';
import type {
  MeetingMinutes,
  MinutesStats,
  MinutesSearchResult,
} from '../types/minutes';

interface MinutesState {
  // Detail view
  currentMinutes: MeetingMinutes | null;
  currentLoading: boolean;

  // Stats
  stats: MinutesStats | null;
  statsLoading: boolean;

  // Search
  searchResults: MinutesSearchResult[];
  searchLoading: boolean;

  // General
  error: string | null;

  // Actions
  fetchMinutes: (minutesId: string) => Promise<void>;
  fetchStats: () => Promise<void>;
  searchMinutes: (query: string) => Promise<void>;
  clearCurrent: () => void;
  setCurrentMinutes: (minutes: MeetingMinutes) => void;
}

export const useMinutesStore = create<MinutesState>((set) => ({
  currentMinutes: null,
  currentLoading: false,

  stats: null,
  statsLoading: false,

  searchResults: [],
  searchLoading: false,

  error: null,

  fetchMinutes: async (minutesId: string) => {
    set({ currentLoading: true, error: null });
    try {
      const minutes = await minutesService.getMinutes(minutesId);
      set({ currentMinutes: minutes, currentLoading: false });
    } catch (err: unknown) {
      set({
        currentLoading: false,
        error: handleStoreError(err, 'Failed to load minutes'),
      });
    }
  },

  fetchStats: async () => {
    set({ statsLoading: true });
    try {
      const stats = await minutesService.getStats();
      set({ stats, statsLoading: false });
    } catch (err: unknown) {
      set({
        statsLoading: false,
        error: handleStoreError(err, 'Failed to load stats'),
      });
    }
  },

  searchMinutes: async (query: string) => {
    set({ searchLoading: true });
    try {
      const results = await minutesService.search(query);
      set({ searchResults: results, searchLoading: false });
    } catch (err: unknown) {
      set({
        searchLoading: false,
        error: handleStoreError(err, 'Failed to search minutes'),
      });
    }
  },

  clearCurrent: () => set({ currentMinutes: null, error: null }),

  setCurrentMinutes: (minutes: MeetingMinutes) => set({ currentMinutes: minutes }),
}));
