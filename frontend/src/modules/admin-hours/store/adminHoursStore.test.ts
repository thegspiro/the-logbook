import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before importing the store) ----

const mockCategoryList = vi.fn();
const mockCategoryCreate = vi.fn();
const mockCategoryUpdate = vi.fn();
const mockCategoryDelete = vi.fn();

const mockClockIn = vi.fn();
const mockClockOut = vi.fn();
const mockClockOutByCategory = vi.fn();
const mockGetActiveSession = vi.fn();

const mockListMy = vi.fn();
const mockListAll = vi.fn();
const mockEditEntry = vi.fn();
const mockReview = vi.fn();
const mockBulkApprove = vi.fn();
const mockGetSummary = vi.fn();
const mockGetPendingCount = vi.fn();
const mockListActiveSessions = vi.fn();
const mockForceClockOut = vi.fn();

vi.mock('../services/api', () => ({
  adminHoursCategoryService: {
    list: (...args: unknown[]) => mockCategoryList(...args) as unknown,
    create: (...args: unknown[]) => mockCategoryCreate(...args) as unknown,
    update: (...args: unknown[]) => mockCategoryUpdate(...args) as unknown,
    delete: (...args: unknown[]) => mockCategoryDelete(...args) as unknown,
  },
  adminHoursClockService: {
    clockIn: (...args: unknown[]) => mockClockIn(...args) as unknown,
    clockOut: (...args: unknown[]) => mockClockOut(...args) as unknown,
    clockOutByCategory: (...args: unknown[]) => mockClockOutByCategory(...args) as unknown,
    getActiveSession: (...args: unknown[]) => mockGetActiveSession(...args) as unknown,
  },
  adminHoursEntryService: {
    listMy: (...args: unknown[]) => mockListMy(...args) as unknown,
    listAll: (...args: unknown[]) => mockListAll(...args) as unknown,
    editEntry: (...args: unknown[]) => mockEditEntry(...args) as unknown,
    review: (...args: unknown[]) => mockReview(...args) as unknown,
    bulkApprove: (...args: unknown[]) => mockBulkApprove(...args) as unknown,
    getSummary: (...args: unknown[]) => mockGetSummary(...args) as unknown,
    getPendingCount: (...args: unknown[]) => mockGetPendingCount(...args) as unknown,
    listActiveSessions: (...args: unknown[]) => mockListActiveSessions(...args) as unknown,
    forceClockOut: (...args: unknown[]) => mockForceClockOut(...args) as unknown,
  },
}));

// ---- Import store AFTER mocks are in place ----
import { useAdminHoursStore } from './adminHoursStore';

// ---- Helpers ----

function getState() {
  return useAdminHoursStore.getState();
}

const makeCategory = (overrides: Record<string, unknown> = {}) => ({
  id: 'cat1',
  organizationId: 'org1',
  name: 'General',
  description: null,
  color: '#FF0000',
  requireApproval: false,
  autoApproveUnderHours: null,
  maxHoursPerSession: null,
  isActive: true,
  sortOrder: 0,
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry1',
  organizationId: 'org1',
  userId: 'user1',
  categoryId: 'cat1',
  clockInAt: '2025-01-01T08:00:00Z',
  clockOutAt: '2025-01-01T12:00:00Z',
  durationMinutes: 240,
  description: null,
  entryMethod: 'manual' as const,
  status: 'pending' as const,
  approvedBy: null,
  approvedAt: null,
  rejectionReason: null,
  createdAt: '2025-01-01T08:00:00Z',
  updatedAt: '2025-01-01T12:00:00Z',
  categoryName: 'General',
  categoryColor: '#FF0000',
  userName: 'John Doe',
  approverName: null,
  ...overrides,
});

const makeActiveSession = (overrides: Record<string, unknown> = {}) => ({
  id: 'entry1',
  categoryId: 'cat1',
  categoryName: 'General',
  categoryColor: '#FF0000',
  clockInAt: '2025-01-01T08:00:00Z',
  elapsedMinutes: 60,
  maxSessionMinutes: null,
  ...overrides,
});

const makeSummary = (overrides: Record<string, unknown> = {}) => ({
  totalHours: 10,
  totalEntries: 5,
  approvedHours: 8,
  approvedEntries: 4,
  pendingHours: 2,
  pendingEntries: 1,
  byCategory: [],
  periodStart: null,
  periodEnd: null,
  ...overrides,
});

const defaultInitialState = {
  categories: [],
  categoriesLoading: false,
  myEntries: [],
  myEntriesTotal: 0,
  allEntries: [],
  allEntriesTotal: 0,
  entriesLoading: false,
  activeSession: null,
  activeSessionLoading: false,
  activeSessions: [],
  activeSessionsLoading: false,
  summary: null,
  pendingCount: 0,
  error: null,
};

// ---- Tests ----

describe('adminHoursStore', () => {
  beforeEach(() => {
    useAdminHoursStore.setState(defaultInitialState);
    vi.clearAllMocks();
  });

  // ---- Initial State ----

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = getState();
      expect(state.categories).toEqual([]);
      expect(state.categoriesLoading).toBe(false);
      expect(state.myEntries).toEqual([]);
      expect(state.myEntriesTotal).toBe(0);
      expect(state.allEntries).toEqual([]);
      expect(state.allEntriesTotal).toBe(0);
      expect(state.entriesLoading).toBe(false);
      expect(state.activeSession).toBeNull();
      expect(state.activeSessionLoading).toBe(false);
      expect(state.activeSessions).toEqual([]);
      expect(state.activeSessionsLoading).toBe(false);
      expect(state.summary).toBeNull();
      expect(state.pendingCount).toBe(0);
      expect(state.error).toBeNull();
    });
  });

  // =========================================================================
  // Categories
  // =========================================================================

  describe('fetchCategories', () => {
    it('should set categoriesLoading and populate categories on success', async () => {
      const categories = [makeCategory(), makeCategory({ id: 'cat2', name: 'Training' })];
      mockCategoryList.mockResolvedValue(categories);

      const promise = getState().fetchCategories();

      expect(getState().categoriesLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.categoriesLoading).toBe(false);
      expect(state.categories).toEqual(categories);
      expect(state.categories).toHaveLength(2);
      expect(mockCategoryList).toHaveBeenCalledWith({ includeInactive: false });
    });

    it('should pass includeInactive parameter', async () => {
      mockCategoryList.mockResolvedValue([]);

      await getState().fetchCategories(true);

      expect(mockCategoryList).toHaveBeenCalledWith({ includeInactive: true });
    });

    it('should handle errors gracefully', async () => {
      mockCategoryList.mockRejectedValue(new Error('Server error'));

      await getState().fetchCategories();

      const state = getState();
      expect(state.categoriesLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
      expect(state.categories).toEqual([]);
    });
  });

  describe('createCategory', () => {
    it('should create a category and refresh the list', async () => {
      const newCategory = makeCategory({ id: 'cat-new', name: 'New Category' });
      mockCategoryCreate.mockResolvedValue(newCategory);
      mockCategoryList.mockResolvedValue([newCategory]);

      const result = await getState().createCategory({ name: 'New Category' });

      expect(result).toEqual(newCategory);
      expect(mockCategoryCreate).toHaveBeenCalledWith({ name: 'New Category' });
      // Should refresh categories with includeInactive=true
      expect(mockCategoryList).toHaveBeenCalledWith({ includeInactive: true });
    });

    it('should set error and re-throw on failure', async () => {
      mockCategoryCreate.mockRejectedValue(new Error('Create failed'));

      await expect(getState().createCategory({ name: 'Bad' })).rejects.toThrow('Create failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('updateCategory', () => {
    it('should update a category and refresh the list', async () => {
      mockCategoryUpdate.mockResolvedValue(undefined);
      mockCategoryList.mockResolvedValue([]);

      await getState().updateCategory('cat1', { name: 'Updated' });

      expect(mockCategoryUpdate).toHaveBeenCalledWith('cat1', { name: 'Updated' });
      expect(mockCategoryList).toHaveBeenCalledWith({ includeInactive: true });
    });

    it('should set error and re-throw on failure', async () => {
      mockCategoryUpdate.mockRejectedValue(new Error('Update failed'));

      await expect(getState().updateCategory('cat1', { name: 'X' })).rejects.toThrow('Update failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('deleteCategory', () => {
    it('should delete a category and refresh the list', async () => {
      mockCategoryDelete.mockResolvedValue(undefined);
      mockCategoryList.mockResolvedValue([]);

      await getState().deleteCategory('cat1');

      expect(mockCategoryDelete).toHaveBeenCalledWith('cat1');
      expect(mockCategoryList).toHaveBeenCalledWith({ includeInactive: true });
    });

    it('should set error and re-throw on failure', async () => {
      mockCategoryDelete.mockRejectedValue(new Error('Delete failed'));

      await expect(getState().deleteCategory('cat1')).rejects.toThrow('Delete failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // Clock In / Clock Out
  // =========================================================================

  describe('clockIn', () => {
    it('should clock in and refresh active session', async () => {
      const session = makeActiveSession();
      mockClockIn.mockResolvedValue({ id: 'entry1', message: 'Clocked in' });
      mockGetActiveSession.mockResolvedValue(session);

      await getState().clockIn('cat1');

      expect(mockClockIn).toHaveBeenCalledWith('cat1');
      expect(mockGetActiveSession).toHaveBeenCalledWith();
      expect(getState().activeSession).toEqual(session);
    });

    it('should set error and re-throw on failure', async () => {
      mockClockIn.mockRejectedValue(new Error('Clock in failed'));

      await expect(getState().clockIn('cat1')).rejects.toThrow('Clock in failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('clockOut', () => {
    it('should clock out, clear active session, and refresh entries', async () => {
      useAdminHoursStore.setState({ activeSession: makeActiveSession() });
      mockClockOut.mockResolvedValue({ id: 'entry1', message: 'Clocked out' });
      mockListMy.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });

      await getState().clockOut('entry1');

      expect(mockClockOut).toHaveBeenCalledWith('entry1');
      expect(getState().activeSession).toBeNull();
      expect(mockListMy).toHaveBeenCalledWith();
    });

    it('should set error and re-throw on failure', async () => {
      mockClockOut.mockRejectedValue(new Error('Clock out failed'));

      await expect(getState().clockOut('entry1')).rejects.toThrow('Clock out failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('clockOutByCategory', () => {
    it('should clock out by category, clear active session, and refresh entries', async () => {
      useAdminHoursStore.setState({ activeSession: makeActiveSession() });
      mockClockOutByCategory.mockResolvedValue({ id: 'entry1', message: 'Clocked out' });
      mockListMy.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });

      await getState().clockOutByCategory('cat1');

      expect(mockClockOutByCategory).toHaveBeenCalledWith('cat1');
      expect(getState().activeSession).toBeNull();
      expect(mockListMy).toHaveBeenCalledWith();
    });

    it('should set error and re-throw on failure', async () => {
      mockClockOutByCategory.mockRejectedValue(new Error('Clock out failed'));

      await expect(getState().clockOutByCategory('cat1')).rejects.toThrow('Clock out failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('fetchActiveSession', () => {
    it('should set activeSessionLoading and populate activeSession on success', async () => {
      const session = makeActiveSession();
      mockGetActiveSession.mockResolvedValue(session);

      const promise = getState().fetchActiveSession();

      expect(getState().activeSessionLoading).toBe(true);

      await promise;

      const state = getState();
      expect(state.activeSessionLoading).toBe(false);
      expect(state.activeSession).toEqual(session);
    });

    it('should set activeSession to null on error (silently)', async () => {
      useAdminHoursStore.setState({ activeSession: makeActiveSession() });
      mockGetActiveSession.mockRejectedValue(new Error('Not found'));

      await getState().fetchActiveSession();

      const state = getState();
      expect(state.activeSessionLoading).toBe(false);
      expect(state.activeSession).toBeNull();
      // Should NOT set error (silent failure)
      expect(state.error).toBeNull();
    });
  });

  // =========================================================================
  // Entries
  // =========================================================================

  describe('fetchMyEntries', () => {
    it('should set entriesLoading and populate myEntries on success', async () => {
      const entries = [makeEntry(), makeEntry({ id: 'entry2' })];
      mockListMy.mockResolvedValue({ entries, total: 2, skip: 0, limit: 50 });

      const promise = getState().fetchMyEntries();

      expect(getState().entriesLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.entriesLoading).toBe(false);
      expect(state.myEntries).toEqual(entries);
      expect(state.myEntriesTotal).toBe(2);
    });

    it('should pass filter params to the service', async () => {
      mockListMy.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });

      const params = { status: 'approved', categoryId: 'cat1', startDate: '2025-01-01' };
      await getState().fetchMyEntries(params);

      expect(mockListMy).toHaveBeenCalledWith(params);
    });

    it('should handle errors gracefully', async () => {
      mockListMy.mockRejectedValue(new Error('Load failed'));

      await getState().fetchMyEntries();

      const state = getState();
      expect(state.entriesLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  describe('fetchAllEntries', () => {
    it('should set entriesLoading and populate allEntries on success', async () => {
      const entries = [makeEntry(), makeEntry({ id: 'entry2' })];
      mockListAll.mockResolvedValue({ entries, total: 2, skip: 0, limit: 50 });

      const promise = getState().fetchAllEntries();

      expect(getState().entriesLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.entriesLoading).toBe(false);
      expect(state.allEntries).toEqual(entries);
      expect(state.allEntriesTotal).toBe(2);
    });

    it('should pass filter params including userId to the service', async () => {
      mockListAll.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });

      const params = { status: 'pending', userId: 'user1' };
      await getState().fetchAllEntries(params);

      expect(mockListAll).toHaveBeenCalledWith(params);
    });

    it('should handle errors gracefully', async () => {
      mockListAll.mockRejectedValue(new Error('Load failed'));

      await getState().fetchAllEntries();

      const state = getState();
      expect(state.entriesLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  describe('editEntry', () => {
    it('should edit an entry and refresh all entries with pending status', async () => {
      mockEditEntry.mockResolvedValue(makeEntry({ description: 'Updated' }));
      mockListAll.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });

      const editData = { description: 'Updated' };
      await getState().editEntry('entry1', editData);

      expect(mockEditEntry).toHaveBeenCalledWith('entry1', editData);
      expect(mockListAll).toHaveBeenCalledWith({ status: 'pending' });
    });

    it('should set error and re-throw on failure', async () => {
      mockEditEntry.mockRejectedValue(new Error('Edit failed'));

      await expect(getState().editEntry('entry1', { description: 'X' })).rejects.toThrow('Edit failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('reviewEntry', () => {
    it('should review (approve) an entry and refresh entries + pending count', async () => {
      mockReview.mockResolvedValue(makeEntry({ status: 'approved' }));
      mockListAll.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });
      mockGetPendingCount.mockResolvedValue(0);

      await getState().reviewEntry('entry1', 'approve');

      expect(mockReview).toHaveBeenCalledWith('entry1', 'approve', undefined);
      expect(mockListAll).toHaveBeenCalledWith({ status: 'pending' });
      expect(mockGetPendingCount).toHaveBeenCalledWith();
    });

    it('should review (reject) an entry with reason', async () => {
      mockReview.mockResolvedValue(makeEntry({ status: 'rejected' }));
      mockListAll.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });
      mockGetPendingCount.mockResolvedValue(0);

      await getState().reviewEntry('entry1', 'reject', 'Invalid hours');

      expect(mockReview).toHaveBeenCalledWith('entry1', 'reject', 'Invalid hours');
    });

    it('should set error and re-throw on failure', async () => {
      mockReview.mockRejectedValue(new Error('Review failed'));

      await expect(getState().reviewEntry('entry1', 'approve')).rejects.toThrow('Review failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('bulkApprove', () => {
    it('should bulk approve entries and return the approved count', async () => {
      mockBulkApprove.mockResolvedValue({ approvedCount: 3 });
      mockListAll.mockResolvedValue({ entries: [], total: 0, skip: 0, limit: 50 });
      mockGetPendingCount.mockResolvedValue(0);

      const result = await getState().bulkApprove(['e1', 'e2', 'e3']);

      expect(result).toBe(3);
      expect(mockBulkApprove).toHaveBeenCalledWith(['e1', 'e2', 'e3']);
      expect(mockListAll).toHaveBeenCalledWith({ status: 'pending' });
      expect(mockGetPendingCount).toHaveBeenCalledWith();
    });

    it('should set error and re-throw on failure', async () => {
      mockBulkApprove.mockRejectedValue(new Error('Bulk approve failed'));

      await expect(getState().bulkApprove(['e1'])).rejects.toThrow('Bulk approve failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('fetchSummary', () => {
    it('should populate summary on success', async () => {
      const summary = makeSummary();
      mockGetSummary.mockResolvedValue(summary);

      await getState().fetchSummary();

      expect(getState().summary).toEqual(summary);
      expect(getState().error).toBeNull();
    });

    it('should pass params to the service', async () => {
      mockGetSummary.mockResolvedValue(makeSummary());

      const params = { userId: 'user1', startDate: '2025-01-01', endDate: '2025-12-31' };
      await getState().fetchSummary(params);

      expect(mockGetSummary).toHaveBeenCalledWith(params);
    });

    it('should handle errors gracefully', async () => {
      mockGetSummary.mockRejectedValue(new Error('Summary failed'));

      await getState().fetchSummary();

      expect(getState().error).toBeTypeOf('string');
    });
  });

  describe('fetchPendingCount', () => {
    it('should update pendingCount on success', async () => {
      mockGetPendingCount.mockResolvedValue(5);

      await getState().fetchPendingCount();

      expect(getState().pendingCount).toBe(5);
    });

    it('should silently fail on error (non-critical badge count)', async () => {
      useAdminHoursStore.setState({ pendingCount: 3 });
      mockGetPendingCount.mockRejectedValue(new Error('Failed'));

      await getState().fetchPendingCount();

      // Should not set error or throw; count remains unchanged
      expect(getState().error).toBeNull();
      expect(getState().pendingCount).toBe(3);
    });
  });

  // =========================================================================
  // Active Sessions (Admin)
  // =========================================================================

  describe('fetchActiveSessions', () => {
    it('should set activeSessionsLoading and populate activeSessions on success', async () => {
      const sessions = [
        {
          id: 'entry1',
          categoryId: 'cat1',
          categoryName: 'General',
          categoryColor: '#FF0000',
          userId: 'user1',
          userName: 'John Doe',
          clockInAt: '2025-01-01T08:00:00Z',
          elapsedMinutes: 60,
          maxSessionMinutes: null,
          description: null,
        },
      ];
      mockListActiveSessions.mockResolvedValue(sessions);

      const promise = getState().fetchActiveSessions();

      expect(getState().activeSessionsLoading).toBe(true);

      await promise;

      const state = getState();
      expect(state.activeSessionsLoading).toBe(false);
      expect(state.activeSessions).toEqual(sessions);
    });

    it('should handle errors gracefully', async () => {
      mockListActiveSessions.mockRejectedValue(new Error('Failed'));

      await getState().fetchActiveSessions();

      const state = getState();
      expect(state.activeSessionsLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  describe('forceClockOut', () => {
    it('should force clock out and refresh active sessions + pending count', async () => {
      mockForceClockOut.mockResolvedValue(makeEntry({ status: 'pending' }));
      mockListActiveSessions.mockResolvedValue([]);
      mockGetPendingCount.mockResolvedValue(1);

      await getState().forceClockOut('entry1');

      expect(mockForceClockOut).toHaveBeenCalledWith('entry1');
      expect(mockListActiveSessions).toHaveBeenCalledWith();
      expect(mockGetPendingCount).toHaveBeenCalledWith();
    });

    it('should set error and re-throw on failure', async () => {
      mockForceClockOut.mockRejectedValue(new Error('Force clock out failed'));

      await expect(getState().forceClockOut('entry1')).rejects.toThrow('Force clock out failed');

      expect(getState().error).toBeTypeOf('string');
    });
  });

  // =========================================================================
  // clearError
  // =========================================================================

  describe('clearError', () => {
    it('should clear the error state', () => {
      useAdminHoursStore.setState({ error: 'Something went wrong' });

      getState().clearError();

      expect(getState().error).toBeNull();
    });
  });
});
