/**
 * Email Templates Store
 *
 * Zustand store for managing email template state in the communications module.
 */

import { create } from 'zustand';
import { emailTemplatesService } from '../../../services/api';
import { createFetchAction, handleStoreError } from '../../../utils/storeHelpers';
import type { EmailTemplate, EmailTemplateUpdate, EmailTemplatePreview, TemplatePreviewOverrides } from '../types';

interface EmailTemplatesState {
  // Data
  templates: EmailTemplate[];
  selectedTemplate: EmailTemplate | null;
  preview: EmailTemplatePreview | null;

  // Loading/Error
  isLoading: boolean;
  isSaving: boolean;
  isPreviewing: boolean;
  error: string | null;

  // Actions
  fetchTemplates: () => Promise<void>;
  selectTemplate: (template: EmailTemplate | null) => void;
  updateTemplate: (templateId: string, data: EmailTemplateUpdate) => Promise<void>;
  previewTemplate: (
    templateId: string,
    context?: Record<string, unknown>,
    overrides?: TemplatePreviewOverrides,
    memberId?: string
  ) => Promise<void>;
  clearPreview: () => void;
  clearError: () => void;
}

/** Which preview request is the current one; see previewTemplate. */
let previewGeneration = 0;

export const useEmailTemplatesStore = create<EmailTemplatesState>((set) => ({
  templates: [],
  selectedTemplate: null,
  preview: null,
  isLoading: false,
  isSaving: false,
  isPreviewing: false,
  error: null,

  fetchTemplates: createFetchAction(
    set,
    () => emailTemplatesService.getTemplates(),
    'templates',
    'Failed to load email templates'
  ),

  selectTemplate: (template) => {
    set({ selectedTemplate: template, preview: null });
  },

  updateTemplate: async (templateId, data) => {
    set({ isSaving: true, error: null });
    try {
      const updated = await emailTemplatesService.updateTemplate(templateId, data);
      set((state) => ({
        templates: state.templates.map((t) => (t.id === templateId ? updated : t)),
        selectedTemplate: state.selectedTemplate?.id === templateId ? updated : state.selectedTemplate,
        isSaving: false,
      }));
    } catch (err: unknown) {
      set({ error: handleStoreError(err, 'Failed to update template'), isSaving: false });
      throw err;
    }
  },

  previewTemplate: async (templateId, context, overrides, memberId) => {
    // The debounce upstream cancels a pending timer, not a request already in
    // flight. Two previews can therefore be open at once — change the draft,
    // or pick a different member, while the first is still running — and the
    // slower one settling last would paint stale content over newer. The pane
    // would then contradict the body on screen until something else refreshed
    // it, which is the one thing a live preview must not do.
    //
    // A monotonic token rather than an AbortController: the response still has
    // to be discarded even when it arrives before the abort lands, so the
    // check is needed either way and the token is the whole of it.
    const token = ++previewGeneration;
    set({ isPreviewing: true, error: null });
    try {
      const preview = await emailTemplatesService.previewTemplate(templateId, context, overrides, memberId);
      if (token !== previewGeneration) return;
      set({ preview, isPreviewing: false });
    } catch (err: unknown) {
      if (token !== previewGeneration) return;
      set({ error: handleStoreError(err, 'Failed to preview template'), isPreviewing: false });
    }
  },

  clearPreview: () => set({ preview: null }),
  clearError: () => set({ error: null }),
}));
