/**
 * Scheduled Emails Store
 *
 * Zustand store for managing scheduled email state.
 */

import { create } from 'zustand';
import {
  scheduledEmailsService,
  type ScheduledEmail,
  type ScheduledEmailCreate,
} from '../../../services/api';
import { createFetchAction, handleStoreError } from '../../../utils/storeHelpers';

interface ScheduledEmailsState {
  scheduledEmails: ScheduledEmail[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchScheduledEmails: (statusFilter?: string) => Promise<void>;
  scheduleEmail: (data: ScheduledEmailCreate) => Promise<void>;
  cancelScheduledEmail: (id: string) => Promise<void>;
  rescheduleEmail: (id: string, scheduledAt: string) => Promise<void>;
  clearError: () => void;
}

export const useScheduledEmailsStore = create<ScheduledEmailsState>((set) => ({
  scheduledEmails: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchScheduledEmails: createFetchAction(
    set,
    (statusFilter?: string) => scheduledEmailsService.list(statusFilter),
    'scheduledEmails',
    'Failed to load scheduled emails',
  ),

  scheduleEmail: async (data: ScheduledEmailCreate) => {
    set({ isSaving: true, error: null });
    try {
      const created = await scheduledEmailsService.create(data);
      set((state) => ({
        scheduledEmails: [created, ...state.scheduledEmails],
        isSaving: false,
      }));
    } catch (err: unknown) {
      set({ isSaving: false, error: handleStoreError(err, 'Failed to schedule email') });
      throw err;
    }
  },

  cancelScheduledEmail: async (id: string) => {
    set({ isSaving: true, error: null });
    try {
      await scheduledEmailsService.cancel(id);
      set((state) => ({
        scheduledEmails: state.scheduledEmails.filter((e) => e.id !== id),
        isSaving: false,
      }));
    } catch (err: unknown) {
      set({ isSaving: false, error: handleStoreError(err, 'Failed to cancel scheduled email') });
    }
  },

  rescheduleEmail: async (id: string, scheduledAt: string) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await scheduledEmailsService.update(id, {
        scheduled_at: scheduledAt,
      });
      set((state) => ({
        scheduledEmails: state.scheduledEmails.map((e) =>
          e.id === id ? updated : e,
        ),
        isSaving: false,
      }));
    } catch (err: unknown) {
      set({ isSaving: false, error: handleStoreError(err, 'Failed to reschedule email') });
    }
  },

  clearError: () => set({ error: null }),
}));
