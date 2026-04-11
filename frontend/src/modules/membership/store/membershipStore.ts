/**
 * Membership Store
 *
 * Zustand store for managing member state with client-side pagination.
 */

import { create } from 'zustand';
import { userService } from '../../../services/api';
import type { ContactInfoSettings, UserWithRoles } from '../types';
import type { User } from '../../../types/user';
import type { MemberStats } from '../../../types/member';
import { UserStatus } from '../../../constants/enums';
import { handleStoreError } from '../../../utils/storeHelpers';

interface MembershipState {
  // Data
  members: User[];
  currentMember: UserWithRoles | null;
  stats: MemberStats;
  contactInfoSettings: ContactInfoSettings | null;

  // Pagination
  totalMembers: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;

  // Filters
  searchQuery: string;
  statusFilter: string;

  // Loading states
  isLoading: boolean;
  isLoadingMember: boolean;
  error: string | null;

  // Actions
  fetchMembers: (page?: number) => Promise<void>;
  fetchMember: (userId: string) => Promise<void>;
  fetchContactInfoSettings: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: string) => void;
  setCurrentMember: (member: UserWithRoles | null) => void;
  clearError: () => void;
}

const defaultStats: MemberStats = {
  total: 0,
  active: 0,
  inactive: 0,
  onLeave: 0,
  retired: 0,
  expiringCertifications: 0,
};

export const useMembershipStore = create<MembershipState>((set, get) => ({
  // Initial state
  members: [],
  currentMember: null,
  stats: defaultStats,
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

  // Actions
  fetchMembers: async (page?: number) => {
    const state = get();
    const pageToFetch = page ?? state.currentPage;

    set({ isLoading: true, error: null });

    try {
      const allMembers = await userService.getUsers();

      // Client-side filtering (backend pagination can be added when API supports it)
      let filtered = allMembers;

      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        filtered = filtered.filter(
          (m) =>
            (m.first_name?.toLowerCase().includes(q)) ||
            (m.last_name?.toLowerCase().includes(q)) ||
            (m.full_name?.toLowerCase().includes(q)) ||
            (m.username?.toLowerCase().includes(q)) ||
            (m.email?.toLowerCase().includes(q)) ||
            (m.membership_number?.toLowerCase().includes(q))
        );
      }

      if (state.statusFilter && state.statusFilter !== 'all') {
        filtered = filtered.filter(
          (m) => m.status?.toLowerCase() === state.statusFilter.toLowerCase()
        );
      }

      // Calculate stats from all members in a single pass
      const stats: MemberStats = allMembers.reduce<MemberStats>(
        (acc, m) => {
          acc.total++;
          if (m.status === UserStatus.ACTIVE) acc.active++;
          else if (m.status === UserStatus.INACTIVE) acc.inactive++;
          else if (m.status === UserStatus.LEAVE) acc.onLeave++;
          else if (m.status === UserStatus.RETIRED) acc.retired++;
          return acc;
        },
        { total: 0, active: 0, inactive: 0, onLeave: 0, retired: 0, expiringCertifications: 0 },
      );

      // Client-side pagination
      const total = filtered.length;
      const totalPages = Math.ceil(total / state.pageSize);
      const safePage = Math.min(pageToFetch, totalPages || 1);
      const startIdx = (safePage - 1) * state.pageSize;
      const paginatedMembers = filtered.slice(startIdx, startIdx + state.pageSize);

      set({
        members: paginatedMembers,
        stats,
        totalMembers: total,
        currentPage: safePage,
        totalPages,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch members'),
        isLoading: false,
      });
    }
  },

  fetchMember: async (userId: string) => {
    set({ isLoadingMember: true, error: null });
    try {
      const member = await userService.getUserWithRoles(userId);
      set({ currentMember: member, isLoadingMember: false });
    } catch (error) {
      set({
        error: handleStoreError(error, 'Failed to fetch member'),
        isLoadingMember: false,
      });
    }
  },

  fetchContactInfoSettings: async () => {
    try {
      const settings = await userService.checkContactInfoEnabled();
      set({ contactInfoSettings: settings });
    } catch {
      // Non-critical, silently fail
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query, currentPage: 1 });
    void get().fetchMembers(1);
  },

  setStatusFilter: (status: string) => {
    set({ statusFilter: status, currentPage: 1 });
    void get().fetchMembers(1);
  },

  setCurrentMember: (member) => {
    set({ currentMember: member });
  },

  clearError: () => {
    set({ error: null });
  },
}));

export default useMembershipStore;
