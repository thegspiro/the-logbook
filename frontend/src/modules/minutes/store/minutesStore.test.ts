import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock services BEFORE importing the store
const mockGetMinutes = vi.fn();
const mockGetStats = vi.fn();
const mockSearch = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getMinutes: (...args: unknown[]) => mockGetMinutes(...args) as unknown,
    getStats: (...args: unknown[]) => mockGetStats(...args) as unknown,
    search: (...args: unknown[]) => mockSearch(...args) as unknown,
  },
}));

import { useMinutesStore } from './minutesStore';
import type { MeetingMinutes, MinutesStats, MinutesSearchResult } from '../types/minutes';

const mockMeetingMinutes: MeetingMinutes = {
  id: 'min-1',
  organization_id: 'org-1',
  title: 'January Business Meeting Minutes',
  meeting_type: 'business',
  meeting_date: '2026-01-15T19:00:00Z',
  location: 'Station 1',
  status: 'draft',
  sections: [
    { order: 1, key: 'old_business', title: 'Old Business', content: 'None.' },
    { order: 2, key: 'new_business', title: 'New Business', content: 'Budget discussion.' },
  ],
  motions: [
    {
      id: 'mot-1',
      minutes_id: 'min-1',
      order: 1,
      motion_text: 'Approve the budget',
      status: 'passed',
      votes_for: 10,
      votes_against: 1,
      votes_abstain: 0,
      created_at: '2026-01-15T19:30:00Z',
      updated_at: '2026-01-15T19:30:00Z',
    },
  ],
  action_items: [
    {
      id: 'ai-1',
      minutes_id: 'min-1',
      description: 'Follow up on budget allocation',
      priority: 'high',
      status: 'pending',
      created_at: '2026-01-15T19:45:00Z',
      updated_at: '2026-01-15T19:45:00Z',
    },
  ],
  created_at: '2026-01-15T18:00:00Z',
  updated_at: '2026-01-15T20:00:00Z',
};

const mockStats: MinutesStats = {
  total: 24,
  this_month: 3,
  open_action_items: 7,
  pending_approval: 2,
};

const mockSearchResults: MinutesSearchResult[] = [
  {
    id: 'min-1',
    title: 'January Business Meeting Minutes',
    meeting_type: 'business',
    meeting_date: '2026-01-15T19:00:00Z',
    status: 'draft',
    snippet: '...budget discussion for Q1...',
    match_field: 'sections',
  },
  {
    id: 'min-2',
    title: 'February Board Meeting',
    meeting_type: 'board',
    meeting_date: '2026-02-10T18:00:00Z',
    status: 'approved',
    snippet: '...budget review completed...',
    match_field: 'title',
  },
];

describe('minutesStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMinutesStore.setState({
      currentMinutes: null,
      currentLoading: false,
      stats: null,
      statsLoading: false,
      searchResults: [],
      searchLoading: false,
      error: null,
    });
  });

  describe('initial state', () => {
    it('should have correct default values', () => {
      const state = useMinutesStore.getState();

      expect(state.currentMinutes).toBeNull();
      expect(state.currentLoading).toBe(false);
      expect(state.stats).toBeNull();
      expect(state.statsLoading).toBe(false);
      expect(state.searchResults).toEqual([]);
      expect(state.searchLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('fetchMinutes', () => {
    it('should fetch and set current minutes on success', async () => {
      mockGetMinutes.mockResolvedValue(mockMeetingMinutes);

      await useMinutesStore.getState().fetchMinutes('min-1');
      const state = useMinutesStore.getState();

      expect(mockGetMinutes).toHaveBeenCalledWith('min-1');
      expect(state.currentMinutes).toEqual(mockMeetingMinutes);
      expect(state.currentLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set loading to true while fetching', async () => {
      let loadingDuringFetch = false;
      mockGetMinutes.mockImplementation(() => {
        loadingDuringFetch = useMinutesStore.getState().currentLoading;
        return Promise.resolve(mockMeetingMinutes);
      });

      await useMinutesStore.getState().fetchMinutes('min-1');

      expect(loadingDuringFetch).toBe(true);
    });

    it('should clear previous error before fetching', async () => {
      useMinutesStore.setState({ error: 'previous error' });
      mockGetMinutes.mockResolvedValue(mockMeetingMinutes);

      await useMinutesStore.getState().fetchMinutes('min-1');

      expect(useMinutesStore.getState().error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockGetMinutes.mockRejectedValue(new Error('Not found'));

      await useMinutesStore.getState().fetchMinutes('bad-id');
      const state = useMinutesStore.getState();

      expect(state.currentMinutes).toBeNull();
      expect(state.currentLoading).toBe(false);
      expect(typeof state.error).toBe('string');
    });

    it('should stop loading on failure', async () => {
      mockGetMinutes.mockRejectedValue(new Error('Server error'));

      await useMinutesStore.getState().fetchMinutes('min-1');

      expect(useMinutesStore.getState().currentLoading).toBe(false);
    });
  });

  describe('fetchStats', () => {
    it('should fetch and set stats on success', async () => {
      mockGetStats.mockResolvedValue(mockStats);

      await useMinutesStore.getState().fetchStats();
      const state = useMinutesStore.getState();

      expect(mockGetStats).toHaveBeenCalledOnce();
      expect(state.stats).toEqual(mockStats);
      expect(state.statsLoading).toBe(false);
    });

    it('should set loading to true while fetching', async () => {
      let loadingDuringFetch = false;
      mockGetStats.mockImplementation(() => {
        loadingDuringFetch = useMinutesStore.getState().statsLoading;
        return Promise.resolve(mockStats);
      });

      await useMinutesStore.getState().fetchStats();

      expect(loadingDuringFetch).toBe(true);
    });

    it('should set error on failure', async () => {
      mockGetStats.mockRejectedValue(new Error('Stats unavailable'));

      await useMinutesStore.getState().fetchStats();
      const state = useMinutesStore.getState();

      expect(state.stats).toBeNull();
      expect(state.statsLoading).toBe(false);
      expect(typeof state.error).toBe('string');
    });

    it('should stop loading on failure', async () => {
      mockGetStats.mockRejectedValue(new Error('Timeout'));

      await useMinutesStore.getState().fetchStats();

      expect(useMinutesStore.getState().statsLoading).toBe(false);
    });
  });

  describe('searchMinutes', () => {
    it('should search and set results on success', async () => {
      mockSearch.mockResolvedValue(mockSearchResults);

      await useMinutesStore.getState().searchMinutes('budget');
      const state = useMinutesStore.getState();

      expect(mockSearch).toHaveBeenCalledWith('budget');
      expect(state.searchResults).toEqual(mockSearchResults);
      expect(state.searchLoading).toBe(false);
    });

    it('should set loading to true while searching', async () => {
      let loadingDuringSearch = false;
      mockSearch.mockImplementation(() => {
        loadingDuringSearch = useMinutesStore.getState().searchLoading;
        return Promise.resolve(mockSearchResults);
      });

      await useMinutesStore.getState().searchMinutes('budget');

      expect(loadingDuringSearch).toBe(true);
    });

    it('should handle empty results', async () => {
      mockSearch.mockResolvedValue([]);

      await useMinutesStore.getState().searchMinutes('nonexistent');
      const state = useMinutesStore.getState();

      expect(state.searchResults).toEqual([]);
      expect(state.searchLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set error on failure', async () => {
      mockSearch.mockRejectedValue(new Error('Search failed'));

      await useMinutesStore.getState().searchMinutes('budget');
      const state = useMinutesStore.getState();

      expect(state.searchResults).toEqual([]);
      expect(state.searchLoading).toBe(false);
      expect(typeof state.error).toBe('string');
    });

    it('should stop loading on failure', async () => {
      mockSearch.mockRejectedValue(new Error('Network error'));

      await useMinutesStore.getState().searchMinutes('test');

      expect(useMinutesStore.getState().searchLoading).toBe(false);
    });
  });

  describe('clearCurrent', () => {
    it('should clear current minutes and error', () => {
      useMinutesStore.setState({
        currentMinutes: mockMeetingMinutes,
        error: 'some error',
      });

      useMinutesStore.getState().clearCurrent();
      const state = useMinutesStore.getState();

      expect(state.currentMinutes).toBeNull();
      expect(state.error).toBeNull();
    });

    it('should not affect other state', () => {
      useMinutesStore.setState({
        currentMinutes: mockMeetingMinutes,
        stats: mockStats,
        searchResults: mockSearchResults,
        error: 'some error',
      });

      useMinutesStore.getState().clearCurrent();
      const state = useMinutesStore.getState();

      expect(state.stats).toEqual(mockStats);
      expect(state.searchResults).toEqual(mockSearchResults);
    });
  });

  describe('setCurrentMinutes', () => {
    it('should set current minutes directly', () => {
      useMinutesStore.getState().setCurrentMinutes(mockMeetingMinutes);

      expect(useMinutesStore.getState().currentMinutes).toEqual(mockMeetingMinutes);
    });

    it('should overwrite existing current minutes', () => {
      useMinutesStore.setState({ currentMinutes: mockMeetingMinutes });

      const updatedMinutes: MeetingMinutes = {
        ...mockMeetingMinutes,
        id: 'min-2',
        title: 'Updated Meeting Minutes',
        status: 'approved',
      };

      useMinutesStore.getState().setCurrentMinutes(updatedMinutes);

      expect(useMinutesStore.getState().currentMinutes).toEqual(updatedMinutes);
      expect(useMinutesStore.getState().currentMinutes?.title).toBe('Updated Meeting Minutes');
    });
  });
});
