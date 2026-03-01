/**
 * Email Templates Store
 *
 * Zustand store for managing email template state in the communications module.
 */

import { create } from 'zustand';
import { emailTemplatesService } from '../../../services/api';
import { handleStoreError } from '../../../utils/storeHelpers';
import type {
  EmailTemplate,
  EmailTemplateUpdate,
  EmailTemplatePreview,
} from '../types';

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
    overrides?: { subject?: string; html_body?: string; css_styles?: string },
    memberId?: string,
  ) => Promise<void>;
  clearPreview: () => void;
  clearError: () => void;
}

export const useEmailTemplatesStore = create<EmailTemplatesState>((set) => ({
  templates: [],
  selectedTemplate: null,
  preview: null,
  isLoading: false,
  isSaving: false,
  isPreviewing: false,
  error: null,

  fetchTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const templates = await emailTemplatesService.getTemplates();
      set({ templates, isLoading: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to load email templates');
      set({ error: message, isLoading: false });
    }
  },

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
      const message = handleStoreError(err, 'Failed to update template');
      set({ error: message, isSaving: false });
      throw err;
    }
  },

  previewTemplate: async (templateId, context, overrides, memberId) => {
    set({ isPreviewing: true, error: null });
    try {
      const preview = await emailTemplatesService.previewTemplate(templateId, context, overrides, memberId);
      set({ preview, isPreviewing: false });
    } catch (err: unknown) {
      const message = handleStoreError(err, 'Failed to preview template');
      set({ error: message, isPreviewing: false });
    }
  },

  clearPreview: () => set({ preview: null }),
  clearError: () => set({ error: null }),
}));
