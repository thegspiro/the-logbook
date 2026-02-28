import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock services BEFORE importing the store
const mockGetUsers = vi.fn();
const mockGetTemplates = vi.fn();
const mockGetBasicApparatus = vi.fn();
const mockGetSummary = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    getTemplates: (...args: unknown[]) => mockGetTemplates(...args) as unknown,
    getBasicApparatus: (...args: unknown[]) => mockGetBasicApparatus(...args) as unknown,
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
  },
}));

vi.mock('../../../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
  },
}));

import { useSchedulingStore } from './schedulingStore';

describe('schedulingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store between tests
    useSchedulingStore.setState({
      members: [],
      membersLoaded: false,
      membersLoading: false,
      templates: [],
      templatesLoaded: false,
      templatesLoading: false,
      apparatus: [],
      apparatusLoaded: false,
      summary: null,
      summaryLoading: false,
      shifts: [],
      shiftsLoading: false,
      shiftsError: null,
    });
  });

  describe('loadMembers', () => {
    it('should load and normalize active members', async () => {
      mockGetUsers.mockResolvedValue([
        { id: '1', first_name: 'Jane', last_name: 'Doe', email: 'jane@test.com', status: 'active' },
        { id: '2', first_name: 'John', last_name: 'Smith', email: 'john@test.com', status: 'active' },
        { id: '3', first_name: 'Bob', last_name: 'Inactive', email: 'bob@test.com', status: 'inactive' },
      ]);

      await useSchedulingStore.getState().loadMembers();
      const state = useSchedulingStore.getState();

      expect(state.membersLoaded).toBe(true);
      expect(state.membersLoading).toBe(false);
      expect(state.members).toHaveLength(2);
      expect(state.members[0]).toEqual({ id: '1', label: 'Jane Doe' });
      expect(state.members[1]).toEqual({ id: '2', label: 'John Smith' });
    });

    it('should not re-fetch if already loaded', async () => {
      useSchedulingStore.setState({ membersLoaded: true });

      await useSchedulingStore.getState().loadMembers();

      expect(mockGetUsers).not.toHaveBeenCalled();
    });

    it('should not re-fetch if currently loading', async () => {
      useSchedulingStore.setState({ membersLoading: true });

      await useSchedulingStore.getState().loadMembers();

      expect(mockGetUsers).not.toHaveBeenCalled();
    });

    it('should handle fetch failure gracefully', async () => {
      mockGetUsers.mockRejectedValue(new Error('Network error'));

      await useSchedulingStore.getState().loadMembers();
      const state = useSchedulingStore.getState();

      expect(state.membersLoading).toBe(false);
      expect(state.members).toEqual([]);
    });

    it('should fall back to email for members without names', async () => {
      mockGetUsers.mockResolvedValue([
        { id: '1', first_name: '', last_name: '', email: 'no-name@test.com', status: 'active' },
      ]);

      await useSchedulingStore.getState().loadMembers();

      expect(useSchedulingStore.getState().members[0]?.label).toBe('no-name@test.com');
    });
  });

  describe('loadTemplates', () => {
    it('should load active templates', async () => {
      const templates = [
        { id: 't1', name: 'Day Shift', is_active: true },
        { id: 't2', name: 'Night Shift', is_active: true },
      ];
      mockGetTemplates.mockResolvedValue(templates);

      await useSchedulingStore.getState().loadTemplates();
      const state = useSchedulingStore.getState();

      expect(state.templatesLoaded).toBe(true);
      expect(state.templates).toEqual(templates);
      expect(mockGetTemplates).toHaveBeenCalledWith({ active_only: true });
    });

    it('should mark loaded even on error to prevent retry loop', async () => {
      mockGetTemplates.mockRejectedValue(new Error('API error'));

      await useSchedulingStore.getState().loadTemplates();

      expect(useSchedulingStore.getState().templatesLoaded).toBe(true);
    });
  });

  describe('loadApparatus', () => {
    it('should load apparatus list', async () => {
      const apparatus = [
        { id: 'a1', name: 'Engine 1', unit_number: 'E1', apparatus_type: 'engine', is_active: true },
      ];
      mockGetBasicApparatus.mockResolvedValue(apparatus);

      await useSchedulingStore.getState().loadApparatus();

      expect(useSchedulingStore.getState().apparatus).toEqual(apparatus);
      expect(useSchedulingStore.getState().apparatusLoaded).toBe(true);
    });
  });

  describe('loadSummary', () => {
    it('should load scheduling summary', async () => {
      const summary = {
        total_shifts: 10,
        shifts_this_week: 3,
        shifts_this_month: 12,
        total_hours_this_month: 144,
      };
      mockGetSummary.mockResolvedValue(summary);

      await useSchedulingStore.getState().loadSummary();

      expect(useSchedulingStore.getState().summary).toEqual(summary);
    });

    it('should handle error gracefully', async () => {
      mockGetSummary.mockRejectedValue(new Error('fail'));

      await useSchedulingStore.getState().loadSummary();

      expect(useSchedulingStore.getState().summary).toBeNull();
      expect(useSchedulingStore.getState().summaryLoading).toBe(false);
    });
  });

  describe('loadInitialData', () => {
    it('should load all reference data in parallel', async () => {
      mockGetUsers.mockResolvedValue([]);
      mockGetTemplates.mockResolvedValue([]);
      mockGetBasicApparatus.mockResolvedValue([]);

      await useSchedulingStore.getState().loadInitialData();

      expect(mockGetUsers).toHaveBeenCalledOnce();
      expect(mockGetTemplates).toHaveBeenCalledOnce();
      expect(mockGetBasicApparatus).toHaveBeenCalledOnce();
    });

    it('should skip already-loaded data', async () => {
      useSchedulingStore.setState({
        membersLoaded: true,
        templatesLoaded: true,
        apparatusLoaded: true,
      });

      await useSchedulingStore.getState().loadInitialData();

      expect(mockGetUsers).not.toHaveBeenCalled();
      expect(mockGetTemplates).not.toHaveBeenCalled();
      expect(mockGetBasicApparatus).not.toHaveBeenCalled();
    });
  });

  describe('shift state helpers', () => {
    it('should set shifts', () => {
      const shifts = [{ id: 's1' }] as never[];
      useSchedulingStore.getState().setShifts(shifts);
      expect(useSchedulingStore.getState().shifts).toEqual(shifts);
    });

    it('should set loading state', () => {
      useSchedulingStore.getState().setShiftsLoading(true);
      expect(useSchedulingStore.getState().shiftsLoading).toBe(true);
    });

    it('should set error state', () => {
      useSchedulingStore.getState().setShiftsError('Something broke');
      expect(useSchedulingStore.getState().shiftsError).toBe('Something broke');
    });
  });
});
