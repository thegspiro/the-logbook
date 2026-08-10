/**
 * Email Footers Store
 *
 * The department's library of named closing blocks. Held whole rather than
 * per-footer because the library saves whole: the default has to name a
 * footer that still exists after the save.
 */

import { create } from 'zustand';
import { emailTemplatesService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { EmailFooter, TemplateVariable } from '../types';

interface FootersState {
  footers: EmailFooter[];
  defaultKey: string;
  /** Variables a footer line may use — organization-wide ones only. */
  variables: TemplateVariable[];
  /** Templates currently closing with each footer, keyed by footer key. */
  usage: Record<string, number>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasLoaded: boolean;

  fetchFooters: () => Promise<void>;
  saveFooters: (defaultKey: string, footers: EmailFooter[]) => Promise<void>;
  clearError: () => void;
}

export const useFootersStore = create<FootersState>((set) => ({
  footers: [],
  defaultKey: '',
  variables: [],
  usage: {},
  isLoading: false,
  isSaving: false,
  error: null,
  hasLoaded: false,

  fetchFooters: async () => {
    set({ isLoading: true, error: null });
    try {
      const library = await emailTemplatesService.getFooters();
      set({
        footers: library.footers,
        defaultKey: library.default_key,
        variables: library.variables,
        usage: library.usage,
        isLoading: false,
        hasLoaded: true,
      });
    } catch (err: unknown) {
      set({
        isLoading: false,
        error: getErrorMessage(err, 'Failed to load footers'),
      });
    }
  },

  saveFooters: async (defaultKey, footers) => {
    set({ isSaving: true, error: null });
    try {
      const library = await emailTemplatesService.updateFooters({
        default_key: defaultKey,
        footers,
      });
      set({
        footers: library.footers,
        defaultKey: library.default_key,
        variables: library.variables,
        usage: library.usage,
        isSaving: false,
      });
    } catch (err: unknown) {
      set({
        isSaving: false,
        error: getErrorMessage(err, 'Failed to save footers'),
      });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
