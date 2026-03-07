import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks (must be declared before importing the store) ----

const mockGetUsers = vi.fn();
const mockGetUserWithRoles = vi.fn();
const mockCheckContactInfoEnabled = vi.fn();

vi.mock('../../../services/api', () => ({
  userService: {
    getUsers: (...args: unknown[]) => mockGetUsers(...args) as unknown,
    getUserWithRoles: (...args: unknown[]) => mockGetUserWithRoles(...args) as unknown,
    checkContactInfoEnabled: (...args: unknown[]) => mockCheckContactInfoEnabled(...args) as unknown,
  },
}));

// ---- Import store AFTER mocks are in place ----
import { useMembershipStore } from './membershipStore';

// ---- Helpers ----

function getState() {
  return useMembershipStore.getState();
}

const makeMember = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  organization_id: 'org1',
  username: 'jdoe',
  email: 'john@example.com',
  first_name: 'John',
  last_name: 'Doe',
  full_name: 'John Doe',
  membership_number: 'M001',
  status: 'active',
  ...overrides,
});

const defaultInitialState = {
  members: [],
  currentMember: null,
  stats: {
    total: 0,
    active: 0,
    inactive: 0,
    onLeave: 0,
    retired: 0,
    expiringCertifications: 0,
  },
  contactInfoSettings: null,
  totalMembers: 0,
  currentPage: 1,
  pageSize: 25,
  totalPages: 0,
  searchQuery: '',
  statusFilter: 'all',
  isLoading: false,
  isLoadingMember: false,
  error: null,
};

// ---- Tests ----

describe('membershipStore', () => {
  beforeEach(() => {
    useMembershipStore.setState(defaultInitialState);
    vi.clearAllMocks();
  });

  // ---- Initial State ----

  describe('initial state', () => {
    it('should have correct initial state', () => {
      const state = getState();
      expect(state.members).toEqual([]);
      expect(state.currentMember).toBeNull();
      expect(state.stats).toEqual({
        total: 0,
        active: 0,
        inactive: 0,
        onLeave: 0,
        retired: 0,
        expiringCertifications: 0,
      });
      expect(state.contactInfoSettings).toBeNull();
      expect(state.totalMembers).toBe(0);
      expect(state.currentPage).toBe(1);
      expect(state.pageSize).toBe(25);
      expect(state.totalPages).toBe(0);
      expect(state.searchQuery).toBe('');
      expect(state.statusFilter).toBe('all');
      expect(state.isLoading).toBe(false);
      expect(state.isLoadingMember).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  // ---- fetchMembers ----

  describe('fetchMembers', () => {
    it('should set isLoading while fetching and populate members on success', async () => {
      const members = [
        makeMember({ id: 'u1', first_name: 'John', status: 'active' }),
        makeMember({ id: 'u2', first_name: 'Jane', status: 'inactive' }),
      ];
      mockGetUsers.mockResolvedValue(members);

      const promise = getState().fetchMembers();

      // isLoading should be true while the request is in flight
      expect(getState().isLoading).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.members).toHaveLength(2);
      expect(state.totalMembers).toBe(2);
      expect(state.stats.total).toBe(2);
      expect(state.stats.active).toBe(1);
      expect(state.stats.inactive).toBe(1);
      expect(mockGetUsers).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      mockGetUsers.mockRejectedValue(new Error('Network error'));

      await getState().fetchMembers();

      const state = getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTypeOf('string');
      expect(state.members).toEqual([]);
    });

    it('should paginate results based on pageSize', async () => {
      // Create 30 members (pageSize is 25, so page 1 = 25, page 2 = 5)
      const members = Array.from({ length: 30 }, (_, i) =>
        makeMember({ id: `u${i}`, first_name: `User${i}`, status: 'active' })
      );
      mockGetUsers.mockResolvedValue(members);

      await getState().fetchMembers(1);

      let state = getState();
      expect(state.members).toHaveLength(25);
      expect(state.totalMembers).toBe(30);
      expect(state.totalPages).toBe(2);
      expect(state.currentPage).toBe(1);

      // Fetch page 2
      await getState().fetchMembers(2);
      state = getState();
      expect(state.members).toHaveLength(5);
      expect(state.currentPage).toBe(2);
    });

    it('should filter by search query', async () => {
      const members = [
        makeMember({ id: 'u1', first_name: 'Alice', last_name: 'Smith', full_name: 'Alice Smith', status: 'active' }),
        makeMember({ id: 'u2', first_name: 'Bob', last_name: 'Jones', full_name: 'Bob Jones', status: 'active' }),
      ];
      mockGetUsers.mockResolvedValue(members);

      // Set search query first so it's used during fetchMembers
      useMembershipStore.setState({ searchQuery: 'alice' });

      await getState().fetchMembers(1);

      const state = getState();
      expect(state.members).toHaveLength(1);
      expect(state.totalMembers).toBe(1);
      // Stats should still reflect all members (pre-filter)
      expect(state.stats.total).toBe(2);
    });

    it('should filter by status', async () => {
      const members = [
        makeMember({ id: 'u1', status: 'active' }),
        makeMember({ id: 'u2', status: 'inactive' }),
        makeMember({ id: 'u3', status: 'leave' }),
      ];
      mockGetUsers.mockResolvedValue(members);

      useMembershipStore.setState({ statusFilter: 'inactive' });

      await getState().fetchMembers(1);

      const state = getState();
      expect(state.members).toHaveLength(1);
      expect(state.totalMembers).toBe(1);
      // Stats still reflect all members
      expect(state.stats.total).toBe(3);
    });

    it('should clamp page number to valid range', async () => {
      const members = [
        makeMember({ id: 'u1', status: 'active' }),
      ];
      mockGetUsers.mockResolvedValue(members);

      // Request page 100 with only 1 member (1 page total)
      await getState().fetchMembers(100);

      const state = getState();
      expect(state.currentPage).toBe(1);
      expect(state.members).toHaveLength(1);
    });

    it('should calculate stats correctly for all status types', async () => {
      const members = [
        makeMember({ id: 'u1', status: 'active' }),
        makeMember({ id: 'u2', status: 'active' }),
        makeMember({ id: 'u3', status: 'inactive' }),
        makeMember({ id: 'u4', status: 'leave' }),
        makeMember({ id: 'u5', status: 'retired' }),
      ];
      mockGetUsers.mockResolvedValue(members);

      await getState().fetchMembers();

      const { stats } = getState();
      expect(stats.total).toBe(5);
      expect(stats.active).toBe(2);
      expect(stats.inactive).toBe(1);
      expect(stats.onLeave).toBe(1);
      expect(stats.retired).toBe(1);
      expect(stats.expiringCertifications).toBe(0);
    });
  });

  // ---- fetchMember ----

  describe('fetchMember', () => {
    it('should set isLoadingMember and populate currentMember on success', async () => {
      const member = makeMember({ id: 'u1', roles: [{ id: 'r1', name: 'Admin' }] });
      mockGetUserWithRoles.mockResolvedValue(member);

      const promise = getState().fetchMember('u1');

      expect(getState().isLoadingMember).toBe(true);
      expect(getState().error).toBeNull();

      await promise;

      const state = getState();
      expect(state.isLoadingMember).toBe(false);
      expect(state.currentMember).toEqual(member);
      expect(mockGetUserWithRoles).toHaveBeenCalledWith('u1');
    });

    it('should handle errors gracefully', async () => {
      mockGetUserWithRoles.mockRejectedValue(new Error('Not found'));

      await getState().fetchMember('bad-id');

      const state = getState();
      expect(state.isLoadingMember).toBe(false);
      expect(state.error).toBeTypeOf('string');
    });
  });

  // ---- fetchContactInfoSettings ----

  describe('fetchContactInfoSettings', () => {
    it('should populate contactInfoSettings on success', async () => {
      const settings = {
        enabled: true,
        show_email: true,
        show_phone: false,
        show_mobile: true,
      };
      mockCheckContactInfoEnabled.mockResolvedValue(settings);

      await getState().fetchContactInfoSettings();

      expect(getState().contactInfoSettings).toEqual(settings);
    });

    it('should silently fail on error (non-critical)', async () => {
      mockCheckContactInfoEnabled.mockRejectedValue(new Error('Server error'));

      await getState().fetchContactInfoSettings();

      // Should not set error or throw
      expect(getState().contactInfoSettings).toBeNull();
      expect(getState().error).toBeNull();
    });
  });

  // ---- setSearchQuery ----

  describe('setSearchQuery', () => {
    it('should update searchQuery, reset page to 1, and trigger fetchMembers', async () => {
      mockGetUsers.mockResolvedValue([]);
      useMembershipStore.setState({ currentPage: 5 });

      getState().setSearchQuery('test');

      expect(getState().searchQuery).toBe('test');
      expect(getState().currentPage).toBe(1);
      // fetchMembers is called with void (fire-and-forget)
      expect(mockGetUsers).toHaveBeenCalled();
    });
  });

  // ---- setStatusFilter ----

  describe('setStatusFilter', () => {
    it('should update statusFilter, reset page to 1, and trigger fetchMembers', async () => {
      mockGetUsers.mockResolvedValue([]);
      useMembershipStore.setState({ currentPage: 3 });

      getState().setStatusFilter('inactive');

      expect(getState().statusFilter).toBe('inactive');
      expect(getState().currentPage).toBe(1);
      expect(mockGetUsers).toHaveBeenCalled();
    });
  });

  // ---- setCurrentMember ----

  describe('setCurrentMember', () => {
    it('should set the current member', () => {
      const member = makeMember({ id: 'u99' });
      getState().setCurrentMember(member as ReturnType<typeof getState>['currentMember']);

      expect(getState().currentMember).toEqual(member);
    });

    it('should clear the current member when set to null', () => {
      useMembershipStore.setState({ currentMember: makeMember() as ReturnType<typeof getState>['currentMember'] });

      getState().setCurrentMember(null);

      expect(getState().currentMember).toBeNull();
    });
  });

  // ---- clearError ----

  describe('clearError', () => {
    it('should clear the error state', () => {
      useMembershipStore.setState({ error: 'Something went wrong' });

      getState().clearError();

      expect(getState().error).toBeNull();
    });
  });
});
