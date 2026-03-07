/**
 * IP Security Zustand Store
 */

import { create } from 'zustand';
import { handleStoreError } from '../../../utils/storeHelpers';
import { ipSecurityService } from '../services/api';
import type {
  BlockedAccessAttempt,
  CountryBlockRule,
  CountryBlockRuleCreate,
  IPException,
  IPExceptionApprove,
  IPExceptionAuditLog,
  IPExceptionReject,
  IPExceptionRequestCreate,
  IPExceptionRevoke,
} from '../types';

interface IPSecurityState {
  // Data
  myExceptions: IPException[];
  pendingExceptions: IPException[];
  allExceptions: IPException[];
  allExceptionsTotal: number;
  blockedAttempts: BlockedAccessAttempt[];
  blockedAttemptsTotal: number;
  blockedCountries: CountryBlockRule[];
  auditLog: IPExceptionAuditLog[];

  // Loading states
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  // Active tab tracking
  activeTab: 'pending' | 'all' | 'blocked-attempts' | 'blocked-countries' | 'my-requests';

  // Actions
  setActiveTab: (tab: IPSecurityState['activeTab']) => void;
  fetchMyExceptions: (includeExpired?: boolean) => Promise<void>;
  fetchPendingExceptions: () => Promise<void>;
  fetchAllExceptions: (status?: string, limit?: number, offset?: number) => Promise<void>;
  fetchBlockedAttempts: (limit?: number, offset?: number, countryCode?: string) => Promise<void>;
  fetchBlockedCountries: () => Promise<void>;
  fetchAuditLog: (exceptionId: string) => Promise<void>;
  requestException: (data: IPExceptionRequestCreate) => Promise<IPException>;
  approveException: (id: string, data: IPExceptionApprove) => Promise<void>;
  rejectException: (id: string, data: IPExceptionReject) => Promise<void>;
  revokeException: (id: string, data: IPExceptionRevoke) => Promise<void>;
  addBlockedCountry: (data: CountryBlockRuleCreate) => Promise<void>;
  removeBlockedCountry: (countryCode: string) => Promise<void>;
  clearError: () => void;
}

export const useIPSecurityStore = create<IPSecurityState>((set) => ({
  myExceptions: [],
  pendingExceptions: [],
  allExceptions: [],
  allExceptionsTotal: 0,
  blockedAttempts: [],
  blockedAttemptsTotal: 0,
  blockedCountries: [],
  auditLog: [],
  isLoading: false,
  isSaving: false,
  error: null,
  activeTab: 'pending',

  setActiveTab: (tab) => set({ activeTab: tab }),

  fetchMyExceptions: async (includeExpired = false) => {
    set({ isLoading: true, error: null });
    try {
      const myExceptions = await ipSecurityService.getMyExceptions(includeExpired);
      set({ myExceptions, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load your IP exceptions');
      set({ error: message, isLoading: false });
    }
  },

  fetchPendingExceptions: async () => {
    set({ isLoading: true, error: null });
    try {
      const pendingExceptions = await ipSecurityService.getPendingExceptions();
      set({ pendingExceptions, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load pending exceptions');
      set({ error: message, isLoading: false });
    }
  },

  fetchAllExceptions: async (status?: string, limit = 50, offset = 0) => {
    set({ isLoading: true, error: null });
    try {
      const res = await ipSecurityService.getAllExceptions(status, limit, offset);
      set({ allExceptions: res.items, allExceptionsTotal: res.total, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load exceptions');
      set({ error: message, isLoading: false });
    }
  },

  fetchBlockedAttempts: async (limit = 50, offset = 0, countryCode?: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await ipSecurityService.getBlockedAttempts(limit, offset, countryCode);
      set({ blockedAttempts: res.items, blockedAttemptsTotal: res.total, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load blocked attempts');
      set({ error: message, isLoading: false });
    }
  },

  fetchBlockedCountries: async () => {
    set({ isLoading: true, error: null });
    try {
      const blockedCountries = await ipSecurityService.getBlockedCountries();
      set({ blockedCountries, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load blocked countries');
      set({ error: message, isLoading: false });
    }
  },

  fetchAuditLog: async (exceptionId: string) => {
    set({ isLoading: true, error: null });
    try {
      const auditLog = await ipSecurityService.getExceptionAuditLog(exceptionId);
      set({ auditLog, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load audit log');
      set({ error: message, isLoading: false });
    }
  },

  requestException: async (data: IPExceptionRequestCreate) => {
    set({ isSaving: true, error: null });
    try {
      const exception = await ipSecurityService.requestException(data);
      set((state) => ({
        myExceptions: [exception, ...state.myExceptions],
        isSaving: false,
      }));
      return exception;
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to submit IP exception request');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  approveException: async (id: string, data: IPExceptionApprove) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await ipSecurityService.approveException(id, data);
      set((state) => ({
        pendingExceptions: state.pendingExceptions.filter((e) => e.id !== id),
        allExceptions: state.allExceptions.map((e) => (e.id === id ? updated : e)),
        isSaving: false,
      }));
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to approve exception');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  rejectException: async (id: string, data: IPExceptionReject) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await ipSecurityService.rejectException(id, data);
      set((state) => ({
        pendingExceptions: state.pendingExceptions.filter((e) => e.id !== id),
        allExceptions: state.allExceptions.map((e) => (e.id === id ? updated : e)),
        isSaving: false,
      }));
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to reject exception');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  revokeException: async (id: string, data: IPExceptionRevoke) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await ipSecurityService.revokeException(id, data);
      set((state) => ({
        allExceptions: state.allExceptions.map((e) => (e.id === id ? updated : e)),
        isSaving: false,
      }));
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to revoke exception');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  addBlockedCountry: async (data: CountryBlockRuleCreate) => {
    set({ isSaving: true, error: null });
    try {
      const rule = await ipSecurityService.addBlockedCountry(data);
      set((state) => ({
        blockedCountries: [...state.blockedCountries, rule],
        isSaving: false,
      }));
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to add blocked country');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  removeBlockedCountry: async (countryCode: string) => {
    set({ isSaving: true, error: null });
    try {
      await ipSecurityService.removeBlockedCountry(countryCode);
      set((state) => ({
        blockedCountries: state.blockedCountries.filter(
          (c) => c.countryCode !== countryCode.toUpperCase(),
        ),
        isSaving: false,
      }));
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to remove blocked country');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
