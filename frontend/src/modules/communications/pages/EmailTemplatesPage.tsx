/**
 * Email Templates Page
 *
 * Admin page for viewing, editing, and previewing email notification templates.
 * Layout: sidebar template list + editor + live preview panel.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  CalendarClock,
  Plus,
  Pencil,
  Eye,
  History,
  RotateCcw,
  PenLine,
  Send,
  UserCheck,
} from 'lucide-react';
import { Breadcrumbs, ConfirmDialog, SkeletonPage } from '../../../components/ux';
import { useEmailTemplatesStore } from '../store/emailTemplatesStore';
import { useOfficersStore } from '../store/officersStore';
import { useFootersStore } from '../store/footersStore';
import { emailTemplatesService, userService } from '../../../services/api';
import { TemplateList } from '../components/TemplateList';
import { TemplateEditor } from '../components/TemplateEditor';
import { TemplatePreview } from '../components/TemplatePreview';
import ScheduleEmailForm from '../components/ScheduleEmailForm';
import ScheduledEmailList from '../components/ScheduledEmailList';
import MessageHistoryList from '../components/MessageHistoryList';
import OfficersPanel from '../components/OfficersPanel';
import FootersPanel from '../components/FootersPanel';
import type { EmailTemplateUpdate, EmailAttachment } from '../types';
import toast from 'react-hot-toast';

interface PreviewMember {
  id: string;
  full_name?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  email?: string | undefined;
}

/**
 * No client-side sample context needed — the backend preview endpoint
 * automatically merges type-appropriate sample data from SAMPLE_CONTEXT
 * in email_template_service.py when context is empty.
 */

/**
 * The page's tabs, in the order they render.
 *
 * Declared as a value rather than a bare union so the `?tab=` parameter can be
 * validated against it — a union alone gives nothing to check an arbitrary
 * query string against at runtime.
 */
const EMAIL_TEMPLATES_TABS = ['templates', 'footers', 'officers', 'scheduled', 'history'] as const;
type EmailTemplatesTab = (typeof EMAIL_TEMPLATES_TABS)[number];

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
    clearPreview,
    clearError,
  } = useEmailTemplatesStore();

  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [, setIsDirty] = useState(false);
  const officerVariables = useOfficersStore((s) => s.variables);
  const fetchOfficers = useOfficersStore((s) => s.fetchOfficers);
  const footers = useFootersStore((s) => s.footers);
  const footerDefaultKey = useFootersStore((s) => s.defaultKey);
  const fetchFooters = useFootersStore((s) => s.fetchFooters);

  // All five tabs are addressable. They were plain state, so a link to the
  // Footers library — the one tab a secretary has cause to send a colleague —
  // always landed on Templates, and the screenshot harness could only ever
  // shoot the default.
  //
  // Derived from the URL rather than mirrored into state. Mirroring reads the
  // parameter once, on mount, so every *later* URL change is ignored — and the
  // Back button is exactly that: click Footers then Officers, press Back, and
  // the address bar says `?tab=footers` while the page still renders Officers.
  // One source of truth removes the class of bug rather than patching the
  // instance, and there is no state left to fall out of step.
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab: EmailTemplatesTab = EMAIL_TEMPLATES_TABS.includes(requestedTab as EmailTemplatesTab)
    ? (requestedTab as EmailTemplatesTab)
    : 'templates';

  const handleTabChange = (tab: EmailTemplatesTab) => {
    setSearchParams({ tab });
  };
  const [editorView, setEditorView] = useState<'edit' | 'preview'>('edit');
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [members, setMembers] = useState<PreviewMember[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [previewMemberId, setPreviewMemberId] = useState<string | undefined>(undefined);
  const [attachmentToDelete, setAttachmentToDelete] = useState<EmailAttachment | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);

  useEffect(() => {
    void fetchTemplates();
    // Loaded up front (not only on the Officers tab) so the editor's
    // signature-variable palette is populated on first render.
    void fetchOfficers();
    // Same reason as the officers: the editor's footer picker has to be
    // populated before anybody opens the Footers tab.
    void fetchFooters();
    // Fetch org members for the preview dropdown
    setIsLoadingMembers(true);
    void userService
      .getUsers()
      .then((users) => {
        setMembers(
          users.map((u) => ({
            id: u.id,
            full_name: u.full_name,
            first_name: u.first_name,
            last_name: u.last_name,
            email: u.email,
          }))
        );
      })
      .catch(() => {
        // Non-critical — member dropdown will just be empty
      })
      .finally(() => setIsLoadingMembers(false));
  }, [fetchTemplates, fetchOfficers, fetchFooters]);

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
        clearPreview();
        toast.success('Template saved successfully');
      } catch {
        toast.error('Failed to save template');
      }
    },
    [selectedTemplate, updateTemplate, clearPreview]
  );

  const handlePreview = useCallback(
    (memberId?: string) => {
      if (!selectedTemplate) return;
      const mid = memberId !== undefined ? memberId : previewMemberId;
      if (mid !== undefined) setPreviewMemberId(mid);
      // Empty context — backend merges per-type sample data + live org + member
      void previewTemplate(selectedTemplate.id, undefined, undefined, mid || undefined);
    },
    [selectedTemplate, previewTemplate, previewMemberId]
  );

  // Auto-load preview when selecting a template
  useEffect(() => {
    if (selectedTemplate) {
      void previewTemplate(selectedTemplate.id, undefined, undefined, previewMemberId || undefined);
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
      const updated = useEmailTemplatesStore.getState().templates.find((t) => t.id === selectedTemplate.id);
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
      const updated = useEmailTemplatesStore.getState().templates.find((t) => t.id === selectedTemplate.id);
      if (updated) selectTemplate(updated);
      toast.success('Attachment removed');
    } catch {
      toast.error('Failed to delete attachment');
    } finally {
      setAttachmentToDelete(null);
    }
  };

  const handleResetToDefault = async () => {
    if (!selectedTemplate) return;
    setIsResetting(true);
    try {
      const updated = await emailTemplatesService.resetTemplate(selectedTemplate.id);
      // Refresh the template list and re-select
      await fetchTemplates();
      const refreshed = useEmailTemplatesStore.getState().templates.find((t) => t.id === updated.id);
      if (refreshed) selectTemplate(refreshed);
      clearPreview();
      toast.success('Template restored to default');
    } catch {
      toast.error('Failed to reset template');
    } finally {
      setIsResetting(false);
      setShowResetConfirm(false);
    }
  };

  const handleSendTest = async () => {
    if (!selectedTemplate) return;
    setIsSendingTest(true);
    try {
      const { messageHistoryService } = await import('../../../services/api');
      await messageHistoryService.sendTestEmail({
        to_email: '',
        template_id: selectedTemplate.id,
      });
      toast.success('Test email sent to your inbox');
    } catch {
      toast.error('Failed to send test email');
    } finally {
      setIsSendingTest(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Breadcrumbs />
          <SkeletonPage rows={8} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">
        <Breadcrumbs />

        {/* Page Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-orange-600 p-2">
              <Mail className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Email Templates</h1>
              <p className="text-theme-text-muted text-sm">Customize the email notifications sent by the application</p>
            </div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="border-theme-surface-border mb-6 flex items-center gap-1 border-b">
          <button
            onClick={() => handleTabChange('templates')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'templates'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
            }`}
          >
            <Mail className="h-4 w-4" />
            Templates
          </button>
          <button
            onClick={() => handleTabChange('footers')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'footers'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
            }`}
          >
            <PenLine className="h-4 w-4" />
            Footers
          </button>
          <button
            onClick={() => handleTabChange('officers')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'officers'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
            }`}
          >
            <UserCheck className="h-4 w-4" />
            Officers
          </button>
          <button
            onClick={() => handleTabChange('scheduled')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'scheduled'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
            }`}
          >
            <CalendarClock className="h-4 w-4" />
            Scheduled
          </button>
          <button
            onClick={() => handleTabChange('history')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
            }`}
          >
            <History className="h-4 w-4" />
            History
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 flex items-start space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
            <div className="flex-1">
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </div>
            <button
              onClick={clearError}
              className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Footers Tab */}
        {activeTab === 'footers' && <FootersPanel />}

        {/* Officers Tab */}
        {activeTab === 'officers' && <OfficersPanel members={members} isLoadingMembers={isLoadingMembers} />}

        {/* Scheduled Emails Tab */}
        {activeTab === 'scheduled' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-theme-text-primary text-lg font-semibold">Scheduled Emails</h2>
              <button
                onClick={() => setShowScheduleForm(!showScheduleForm)}
                className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" />
                Schedule Email
              </button>
            </div>

            {showScheduleForm && <ScheduleEmailForm templates={templates} onClose={() => setShowScheduleForm(false)} />}

            <ScheduledEmailList />
          </div>
        )}

        {/* History Tab */}
        {activeTab === 'history' && <MessageHistoryList templates={templates} />}

        {/* Templates Tab: Main Layout: Sidebar + Main (tabbed editor/preview) */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Template list sidebar */}
            <div className="lg:col-span-3">
              <div className="bg-theme-surface-modal border-theme-surface-border rounded-xl border p-4 lg:sticky lg:top-6">
                <TemplateList
                  templates={templates}
                  selectedId={selectedTemplate?.id ?? null}
                  onSelect={selectTemplate}
                />
              </div>
            </div>

            {/* Main content area: editor / preview via tabs */}
            <div className="lg:col-span-9">
              {selectedTemplate ? (
                <div className="bg-theme-surface border-theme-surface-border rounded-xl border">
                  {/* Template meta bar */}
                  <div className="border-theme-surface-border flex items-center justify-between border-b px-5 pt-5 pb-4">
                    <div className="flex items-center gap-4">
                      <p className="text-theme-text-muted text-xs">
                        {selectedTemplate.description || 'No description'}
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <button
                        onClick={() => setShowResetConfirm(true)}
                        disabled={isResetting}
                        className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50"
                        title="Restore default content"
                      >
                        {isResetting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        <span>Reset</span>
                      </button>
                      <span className="text-theme-text-muted text-xs">
                        {selectedTemplate.is_active ? 'Active' : 'Inactive'}
                      </span>
                      <button
                        onClick={() => {
                          void handleToggleActive();
                        }}
                        disabled={isTogglingActive}
                        className="text-theme-text-muted hover:text-theme-text-primary transition-colors disabled:opacity-50"
                        title={selectedTemplate.is_active ? 'Deactivate template' : 'Activate template'}
                      >
                        {isTogglingActive ? (
                          <Loader2 className="h-7 w-7 animate-spin" />
                        ) : selectedTemplate.is_active ? (
                          <ToggleRight className="h-7 w-7 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-7 w-7" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Edit / Preview toggle */}
                  <div className="flex items-center gap-1 px-5 pt-3 pb-0">
                    <button
                      onClick={() => setEditorView('edit')}
                      className={`flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                        editorView === 'edit'
                          ? 'bg-theme-surface-secondary border-orange-500 text-orange-600 dark:text-orange-400'
                          : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
                      }`}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        setEditorView('preview');
                        void previewTemplate(selectedTemplate.id, undefined, undefined, previewMemberId || undefined);
                      }}
                      className={`flex items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                        editorView === 'preview'
                          ? 'bg-theme-surface-secondary border-orange-500 text-orange-600 dark:text-orange-400'
                          : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
                      }`}
                    >
                      <Eye className="h-4 w-4" />
                      Preview
                    </button>
                  </div>

                  {/* Content area */}
                  <div className="p-5">
                    {editorView === 'edit' ? (
                      <>
                        <TemplateEditor
                          template={selectedTemplate}
                          isSaving={isSaving}
                          onSave={(data) => {
                            void handleSave(data);
                          }}
                          onDirtyChange={setIsDirty}
                          officerVariables={officerVariables}
                          footers={footers}
                          footerDefaultKey={footerDefaultKey}
                        />

                        {/* Attachments section */}
                        {selectedTemplate.allow_attachments && (
                          <div className="border-theme-surface-border mt-6 border-t pt-4">
                            <div className="mb-3 flex items-center justify-between">
                              <h4 className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold">
                                <Paperclip className="h-4 w-4" />
                                Attachments
                              </h4>
                              <label className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex cursor-pointer items-center space-x-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors">
                                {uploadingAttachment ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Upload className="h-3.5 w-3.5" />
                                )}
                                <span>Upload</span>
                                <input
                                  type="file"
                                  className="hidden"
                                  onChange={(e) => {
                                    void handleUploadAttachment(e);
                                  }}
                                  disabled={uploadingAttachment}
                                />
                              </label>
                            </div>
                            {selectedTemplate.attachments.length > 0 ? (
                              <div className="space-y-2">
                                {selectedTemplate.attachments.map((att) => (
                                  <div
                                    key={att.id}
                                    className="bg-theme-surface-secondary flex items-center justify-between rounded-lg px-3 py-2"
                                  >
                                    <div className="flex min-w-0 items-center space-x-2">
                                      <Paperclip className="text-theme-text-muted h-4 w-4 shrink-0" />
                                      <span className="text-theme-text-primary truncate text-sm">{att.filename}</span>
                                      {att.file_size && (
                                        <span className="text-theme-text-muted shrink-0 text-xs">
                                          ({att.file_size})
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      onClick={() => setAttachmentToDelete(att)}
                                      className="ml-2 shrink-0 text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                                      aria-label={`Delete attachment ${att.filename}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-theme-text-muted text-sm">
                                No attachments. Files uploaded here will be included with every email sent using this
                                template.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <TemplatePreview
                          preview={preview}
                          isPreviewing={isPreviewing}
                          onRefresh={handlePreview}
                          members={members}
                          isLoadingMembers={isLoadingMembers}
                        />
                        {preview && (
                          <div className="border-theme-surface-border mt-4 border-t pt-4">
                            <button
                              onClick={() => {
                                void handleSendTest();
                              }}
                              disabled={isSendingTest || !preview}
                              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:opacity-50"
                            >
                              {isSendingTest ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                              <span>Send Test Email to Me</span>
                            </button>
                            <p className="text-theme-text-muted mt-1.5 text-xs">
                              Sends this preview to your email address so you can verify how it looks in a real inbox.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-12 text-center">
                  <Mail className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                  <h3 className="text-theme-text-primary mb-2 text-xl font-bold">Select a Template</h3>
                  <p className="text-theme-text-secondary">
                    Choose a template from the list to edit its content and preview the result.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
        <ConfirmDialog
          isOpen={attachmentToDelete !== null}
          onClose={() => setAttachmentToDelete(null)}
          onConfirm={() => {
            if (attachmentToDelete) void handleDeleteAttachment(attachmentToDelete);
          }}
          title="Delete Attachment"
          message={`Remove "${attachmentToDelete?.filename ?? ''}" from this template? This attachment will no longer be included in emails.`}
          confirmLabel="Delete"
          variant="danger"
        />
        <ConfirmDialog
          isOpen={showResetConfirm}
          onClose={() => setShowResetConfirm(false)}
          onConfirm={() => {
            void handleResetToDefault();
          }}
          title="Reset to Default"
          message="This will restore the template's subject, HTML body, text body, styles, and footer choice to the system defaults. Your CC/BCC settings will be preserved. This action cannot be undone."
          confirmLabel="Reset"
          variant="danger"
        />
      </main>
    </div>
  );
};

export default EmailTemplatesPage;
