/**
 * Governance — Legal Documents Store
 */

import { create } from 'zustand';

import { getErrorMessage } from '../../../utils/errorHandling';
import { legalDocumentsService } from '../services/api';
import type {
  LegalDocumentType,
  LegalDocumentsOverview,
  LegalRevisionCreate,
  LegalRevisionUpdate,
} from '../types/legal';

interface LegalDocumentsState {
  overview: LegalDocumentsOverview | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchOverview: () => Promise<void>;
  createRevision: (payload: LegalRevisionCreate) => Promise<void>;
  updateRevision: (revisionId: string, payload: LegalRevisionUpdate) => Promise<void>;
  deleteRevision: (revisionId: string) => Promise<void>;
  publishRevision: (revisionId: string) => Promise<void>;
  revertToDefault: (documentType: LegalDocumentType) => Promise<void>;
}

export const useLegalDocumentsStore = create<LegalDocumentsState>((set, get) => {
  /**
   * Run a mutation, then refetch.
   *
   * Every action here changes what the public page serves or what the review
   * list shows, and both are computed server-side from settings plus revision
   * rows — patching a local copy of that would drift from the page a member
   * actually loads.
   */
  const mutate = async (action: () => Promise<unknown>): Promise<void> => {
    set({ isSaving: true, error: null });
    try {
      await action();
      await get().fetchOverview();
    } catch (err: unknown) {
      set({ error: getErrorMessage(err, 'Could not save the revision') });
      throw err;
    } finally {
      set({ isSaving: false });
    }
  };

  return {
    overview: null,
    isLoading: false,
    isSaving: false,
    error: null,

    fetchOverview: async () => {
      set({ isLoading: true, error: null });
      try {
        const overview = await legalDocumentsService.getOverview();
        set({ overview, isLoading: false });
      } catch (err: unknown) {
        set({
          isLoading: false,
          error: getErrorMessage(err, 'Could not load the legal documents'),
        });
      }
    },

    createRevision: (payload) => mutate(() => legalDocumentsService.createRevision(payload)),
    updateRevision: (revisionId, payload) => mutate(() => legalDocumentsService.updateRevision(revisionId, payload)),
    deleteRevision: (revisionId) => mutate(() => legalDocumentsService.deleteRevision(revisionId)),
    publishRevision: (revisionId) => mutate(() => legalDocumentsService.publishRevision(revisionId)),
    revertToDefault: (documentType) => mutate(() => legalDocumentsService.revertToDefault(documentType)),
  };
});
