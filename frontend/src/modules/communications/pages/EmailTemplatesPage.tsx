/**
 * Email Templates Page
 *
 * Admin page for viewing, editing, and previewing email notification templates.
 * Layout: sidebar template list + editor + live preview panel.
 */

import React, { useEffect, useCallback, useState } from 'react';
import {
  Mail,
  AlertCircle,
  X,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from 'lucide-react';
import { Breadcrumbs, SkeletonPage } from '../../../components/ux';
import { useEmailTemplatesStore } from '../store/emailTemplatesStore';
import { emailTemplatesService } from '../../../services/api';
import { TemplateList } from '../components/TemplateList';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplatePreview } from '../components/TemplatePreview';
import type { EmailTemplateUpdate, EmailAttachment } from '../types';
import toast from 'react-hot-toast';

/**
 * No client-side sample context needed — the backend preview endpoint
 * automatically merges type-appropriate sample data from SAMPLE_CONTEXT
 * in email_template_service.py when context is empty.
 */

const EmailTemplatesPage: React.FC = () => {
  const {
    templates,
    selectedTemplate,
    preview,
    isLoading,
    isSaving,
    isPreviewing,
    error,
    fetchTemplates,
    selectTemplate,
    updateTemplate,
    previewTemplate,
    clearError,
  } = useEmailTemplatesStore();

  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [, setIsDirty] = useState(false);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  // Auto-select first template when loaded
  useEffect(() => {
    const first = templates[0];
    if (first && !selectedTemplate) {
      selectTemplate(first);
    }
  }, [templates, selectedTemplate, selectTemplate]);

  const handleSave = useCallback(
    async (data: EmailTemplateUpdate) => {
      if (!selectedTemplate) return;
      try {
        await updateTemplate(selectedTemplate.id, data);
        toast.success('Template saved successfully');
      } catch {
        toast.error('Failed to save template');
      }
    },
    [selectedTemplate, updateTemplate],
  );

  const handlePreview = useCallback(() => {
    if (!selectedTemplate) return;
    // Empty context — backend merges per-type sample data automatically
    void previewTemplate(selectedTemplate.id);
  }, [selectedTemplate, previewTemplate]);

  // Auto-load preview when selecting a template
  useEffect(() => {
    if (selectedTemplate) {
      void previewTemplate(selectedTemplate.id);
    }
    // Only trigger on template selection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id]);

  const handleToggleActive = async () => {
    if (!selectedTemplate) return;
    setIsTogglingActive(true);
    try {
      await updateTemplate(selectedTemplate.id, { is_active: !selectedTemplate.is_active });
      toast.success(selectedTemplate.is_active ? 'Template deactivated' : 'Template activated');
    } catch {
      toast.error('Failed to toggle template status');
    } finally {
      setIsTogglingActive(false);
    }
  };

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedTemplate || !e.target.files?.[0]) return;
    setUploadingAttachment(true);
    try {
      await emailTemplatesService.uploadAttachment(selectedTemplate.id, e.target.files[0]);
      // Refresh templates to get updated attachment list
      await fetchTemplates();
      // Re-select the same template
      const updated = useEmailTemplatesStore.getState().templates.find(
        (t) => t.id === selectedTemplate.id,
      );
      if (updated) selectTemplate(updated);
      toast.success('Attachment uploaded');
    } catch {
      toast.error('Failed to upload attachment');
    } finally {
      setUploadingAttachment(false);
      e.target.value = '';
    }
  };

  const handleDeleteAttachment = async (attachment: EmailAttachment) => {
    if (!selectedTemplate) return;
    try {
      await emailTemplatesService.deleteAttachment(selectedTemplate.id, attachment.id);
      await fetchTemplates();
      const updated = useEmailTemplatesStore.getState().templates.find(
        (t) => t.id === selectedTemplate.id,
      );
      if (updated) selectTemplate(updated);
      toast.success('Attachment removed');
    } catch {
      toast.error('Failed to delete attachment');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <Breadcrumbs />
          <SkeletonPage rows={8} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <Breadcrumbs />

        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-orange-600 rounded-lg p-2">
              <Mail className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">
                Email Templates
              </h1>
              <p className="text-theme-text-muted text-sm">
                Customize the email notifications sent by the application
              </p>
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Layout: Template List | Editor | Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Template list sidebar */}
          <div className="lg:col-span-3">
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-4 lg:sticky lg:top-6">
              <TemplateList
                templates={templates}
                selectedId={selectedTemplate?.id ?? null}
                onSelect={selectTemplate}
              />
            </div>
          </div>

          {/* Editor */}
          <div className="lg:col-span-5">
            {selectedTemplate ? (
              <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5">
                {/* Template meta bar */}
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-theme-surface-border">
                  <div>
                    <p className="text-theme-text-muted text-xs">
                      {selectedTemplate.description || 'No description'}
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-theme-text-muted text-xs">
                      {selectedTemplate.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => { void handleToggleActive(); }}
                      disabled={isTogglingActive}
                      className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-50"
                      title={selectedTemplate.is_active ? 'Deactivate template' : 'Activate template'}
                    >
                      {isTogglingActive ? (
                        <Loader2 className="w-7 h-7 animate-spin" />
                      ) : selectedTemplate.is_active ? (
                        <ToggleRight className="w-7 h-7 text-green-500" />
                      ) : (
                        <ToggleLeft className="w-7 h-7" />
                      )}
                    </button>
                  </div>
                </div>

                <TemplateEditor
                  template={selectedTemplate}
                  isSaving={isSaving}
                  onSave={(data) => { void handleSave(data); }}
                  onDirtyChange={setIsDirty}
                />

                {/* Attachments section */}
                {selectedTemplate.allow_attachments && (
                  <div className="mt-6 pt-4 border-t border-theme-surface-border">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-theme-text-primary text-sm font-semibold flex items-center gap-2">
                        <Paperclip className="w-4 h-4" />
                        Attachments
                      </h4>
                      <label className="flex items-center space-x-1.5 px-3 py-1.5 text-sm border border-theme-surface-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors cursor-pointer">
                        {uploadingAttachment ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Upload className="w-3.5 h-3.5" />
                        )}
                        <span>Upload</span>
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => { void handleUploadAttachment(e); }}
                          disabled={uploadingAttachment}
                        />
                      </label>
                    </div>
                    {selectedTemplate.attachments.length > 0 ? (
                      <div className="space-y-2">
                        {selectedTemplate.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center justify-between bg-theme-surface-secondary rounded-lg px-3 py-2"
                          >
                            <div className="flex items-center space-x-2 min-w-0">
                              <Paperclip className="w-4 h-4 text-theme-text-muted flex-shrink-0" />
                              <span className="text-theme-text-primary text-sm truncate">
                                {att.filename}
                              </span>
                              {att.file_size && (
                                <span className="text-theme-text-muted text-xs flex-shrink-0">
                                  ({att.file_size})
                                </span>
                              )}
                            </div>
                            <button
                              onClick={() => { void handleDeleteAttachment(att); }}
                              className="text-red-400 hover:text-red-300 flex-shrink-0 ml-2"
                              title="Delete attachment"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-theme-text-muted text-sm">
                        No attachments. Files uploaded here will be included with every email sent using this template.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-12 text-center">
                <Mail className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">
                  Select a Template
                </h3>
                <p className="text-theme-text-secondary">
                  Choose a template from the list to edit its content and preview the result.
                </p>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="lg:col-span-4">
            <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 lg:sticky lg:top-6">
              <TemplatePreview
                preview={preview}
                isPreviewing={isPreviewing}
                onRefresh={handlePreview}
              />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default EmailTemplatesPage;
