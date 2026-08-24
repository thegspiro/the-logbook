/**
 * Email Templates Page
 *
 * Admin page for viewing, editing, and previewing email notification
 * templates.
 *
 * Renders through the shared `SettingsLayout` — its sections, its header, its
 * section nav — like every other settings screen.
 *
 * The Templates section asks the shell for its `wide` column. Three columns
 * from `lg` up — list, editor, live preview — rather than an editor and a
 * preview behind tabs. Tabs made the preview something you went and looked at
 * after the fact, which is the one thing it is bad at: the question an admin
 * is actually asking is "does this edit look right", and that needs both
 * halves visible at once. The pair does not fit the shell's standard 960px, so
 * this one panel widens; the other four sections are lists and do not. Below
 * `lg` the two panes stack and a strip switches between them, because three
 * columns do not fit a phone.
 */

import React, { useEffect, useCallback, useRef, useState } from 'react';
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
  Send,
  Save,
  Undo2,
  Sparkles,
  AlignLeft,
  LayoutTemplate,
  Users,
} from 'lucide-react';
import { Breadcrumbs, ConfirmDialog, SkeletonPage } from '../../../components/ux';
import { SettingsLayout, type SettingsSection } from '../../../components/settings/SettingsLayout';
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
import { useTemplateDraft } from '../hooks/useTemplateDraft';
import type { EmailAttachment } from '../types';
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

const SECTIONS: SettingsSection<EmailTemplatesTab>[] = [
  {
    key: 'templates',
    label: 'Templates',
    icon: LayoutTemplate,
    description: 'Message bodies, grouped by the module that sends them',
  },
  { key: 'footers', label: 'Footers', icon: AlignLeft, description: 'Signature blocks appended to outgoing mail' },
  { key: 'officers', label: 'Officers', icon: Users, description: 'Who is addressed by officer-role placeholders' },
  { key: 'scheduled', label: 'Scheduled', icon: CalendarClock, description: 'Messages queued to send later' },
  { key: 'history', label: 'History', icon: History, description: 'What has been sent, and to whom' },
];

/** How long typing has to stop before the preview re-renders. */
const PREVIEW_DEBOUNCE_MS = 500;

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
  const draft = useTemplateDraft(selectedTemplate);
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
  // Only reachable below `lg`, where the two panes stack. On desktop both
  // are on screen and this decides nothing.
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

  const handleSave = useCallback(async () => {
    if (!selectedTemplate || draft.hasValidationErrors) return;
    try {
      await updateTemplate(selectedTemplate.id, draft.buildUpdate());
      toast.success('Template saved successfully');
    } catch {
      toast.error('Failed to save template');
    }
  }, [selectedTemplate, updateTemplate, draft]);

  // Ctrl/Cmd+S. The dependency array is the point: without one this rebound
  // on every render, which for a textarea is every keystroke — a listener
  // added and removed per character typed.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (draft.isDirty && !isSaving && !draft.hasValidationErrors) void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [draft.isDirty, draft.hasValidationErrors, isSaving, handleSave]);

  /**
   * The unsaved draft, in the shape the preview endpoint takes as overrides.
   *
   * Sent on every preview, saved or not: the endpoint has always accepted
   * these, and passing them is what lets the right-hand pane show the edit
   * rather than the last thing written to the database.
   *
   * The accent and layout are omitted when blank rather than sent as ''.
   * A template is allowed to carry neither — the renderer then uses the
   * colourway and layout shipped for its type — but the form holds that
   * absence as an empty string, and '' is not one of the seven accents or
   * three layouts the API accepts. Sending it 422'd the preview on every
   * such template, which took the whole live pane down rather than one
   * field. Every other override keeps '' intact: a cleared footer, chip,
   * plain-text body or stylesheet means "cleared", not "unchanged".
   */
  const previewOverrides = useCallback(
    () => ({
      subject: draft.subject,
      html_body: draft.htmlBody,
      text_body: draft.textBody,
      css_styles: draft.cssStyles,
      footer_key: draft.footerKey,
      header_accent: draft.headerAccent || undefined,
      status_chip: draft.statusChip,
      layout: draft.layout || undefined,
    }),
    [
      draft.subject,
      draft.htmlBody,
      draft.textBody,
      draft.cssStyles,
      draft.footerKey,
      draft.headerAccent,
      draft.statusChip,
      draft.layout,
    ]
  );

  const handlePreview = useCallback(
    (memberId?: string) => {
      if (!selectedTemplate) return;
      const mid = memberId !== undefined ? memberId : previewMemberId;
      if (mid !== undefined) setPreviewMemberId(mid);
      // Empty context — backend merges per-type sample data + live org + member
      void previewTemplate(selectedTemplate.id, undefined, previewOverrides(), mid || undefined);
    },
    [selectedTemplate, previewTemplate, previewMemberId, previewOverrides]
  );

  /**
   * Re-render the preview from the draft, ~500ms after typing stops.
   *
   * Debounced rather than per-keystroke because each render is a round trip
   * that inlines the whole stylesheet server-side; per-keystroke would put a
   * request on the wire for every character of a paragraph and paint them
   * back out of order.
   */
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedTemplate) return;
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      void previewTemplate(selectedTemplate.id, undefined, previewOverrides(), previewMemberId || undefined);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [selectedTemplate, previewTemplate, previewOverrides, previewMemberId]);

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
    <SettingsLayout<EmailTemplatesTab>
      sections={SECTIONS}
      activeSection={activeTab}
      onSectionChange={handleTabChange}
      navLabel="Email settings sections"
      title="Email Templates"
      headerAside={<Breadcrumbs />}
      // Only the Templates panel needs the wide column — it is the one that
      // puts the editor and the live preview beside each other. The other four
      // sections are lists and read better at the width every other settings
      // screen uses.
      width={activeTab === 'templates' ? 'wide' : 'standard'}
    >
      <>
        {/* Save bar for the Templates section.

              Sticky, and it carries Save: with the editor and the preview side
              by side the button used to scroll out of sight while the fields it
              saves stayed on screen.

              It lives here rather than in SettingsLayout's headerAside because
              that header is not sticky — and making it sticky would move every
              other settings screen's header for the sake of this one. Negative
              margins so the bar spans the panel's padding instead of floating
              inside it, and `top-0` because it is the panel's own chrome, not a
              floating element that has to clear the mobile bottom nav.

              On bg-theme-bg, the flat opaque page canvas, not a surface token:
              in dark mode the surface tokens are translucent white by design —
              they are meant to sit *on* the gradient — so a sticky bar painted
              with one shows the content sliding underneath it, which is the
              single thing this bar exists to stop. */}
        {activeTab === 'templates' && selectedTemplate && (
          <div className="bg-theme-bg border-theme-surface-border sticky top-0 z-30 -mx-4 -mt-4 mb-4 border-b px-4 py-3 sm:-mx-6 sm:-mt-6 sm:px-6">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => {
                  void handleSendTest();
                }}
                disabled={isSendingTest || draft.isDirty}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover mobile-touch-target flex items-center gap-2 rounded-lg border px-4 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                // The endpoint renders the stored row, so with unsaved edits
                // on screen this would mail the previous version while the
                // preview beside it shows the new one — and the whole point
                // of the button is checking what a real inbox does with the
                // thing you are looking at.
                title={
                  draft.isDirty
                    ? 'Save first — a test email sends the saved template, not your unsaved edits'
                    : 'Send this template to your own address'
                }
              >
                {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span>Send Test to Me</span>
              </button>
              {draft.isDirty && (
                <button
                  onClick={draft.discard}
                  disabled={isSaving}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover mobile-touch-target flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
                >
                  <Undo2 className="h-4 w-4" />
                  <span>Discard</span>
                </button>
              )}
              <button
                onClick={() => {
                  void handleSave();
                }}
                disabled={!draft.isDirty || isSaving || draft.hasValidationErrors}
                className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed"
                title="Save changes (Ctrl+S)"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span>Save</span>
              </button>
            </div>
          </div>
        )}

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
        {/* A department that has already edited a notice keeps its wording:
              ensure_default_templates only ever creates missing rows, so the
              new design reaches a stored template when — and only when —
              somebody asks for it. Which nothing in the UI would otherwise
              say, leaving an admin to conclude the redesign skipped them. */}
        {activeTab === 'templates' && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-blue-700 dark:text-blue-400" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              A new email design is available. Templates you have never edited already use it — press{' '}
              <span className="font-semibold">Reset</span> on any you have customised to adopt it. Your CC/BCC settings
              are kept.
            </p>
          </div>
        )}
        {/* Templates Tab: list / editor / live preview */}
        {activeTab === 'templates' && (
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[296px_minmax(0,1fr)_468px]">
            {/* Column 1 — template list */}
            <div className="card p-4 lg:sticky lg:top-28">
              <TemplateList templates={templates} selectedId={selectedTemplate?.id ?? null} onSelect={selectTemplate} />
            </div>

            {selectedTemplate ? (
              <>
                {/* Below `lg` the two panes stack, so they need a way to
                      swap. From `lg` up both are visible and this strip is
                      gone — there is nothing left for it to switch. */}
                <div className="tab-scroll lg:hidden">
                  <button
                    onClick={() => setEditorView('edit')}
                    className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      editorView === 'edit'
                        ? 'border-red-500 text-red-600 dark:text-red-400'
                        : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
                    }`}
                  >
                    <Pencil className="h-4 w-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => setEditorView('preview')}
                    className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      editorView === 'preview'
                        ? 'border-red-500 text-red-600 dark:text-red-400'
                        : 'text-theme-text-secondary hover:text-theme-text-primary border-transparent'
                    }`}
                  >
                    <Eye className="h-4 w-4" />
                    Preview
                  </button>
                </div>

                {/* Column 2 — editor */}
                <div
                  className={`${editorView === 'edit' ? 'block' : 'hidden'} card lg:col-start-2 lg:row-start-1 lg:block`}
                >
                  {/* Template meta bar */}
                  <div className="border-theme-surface-border flex flex-col gap-3 border-b px-5 pt-5 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-theme-text-primary truncate text-base font-semibold">
                        {selectedTemplate.name}
                      </p>
                      <p className="text-theme-text-muted text-xs">
                        {selectedTemplate.description || 'No description'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center space-x-3">
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

                  <div className="p-5">
                    <TemplateEditor
                      template={selectedTemplate}
                      draft={draft}
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
                                    <span className="text-theme-text-muted shrink-0 text-xs">({att.file_size})</span>
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
                  </div>
                </div>

                {/* Column 3 — live preview */}
                <div
                  className={`${editorView === 'preview' ? 'block' : 'hidden'} lg:sticky lg:top-28 lg:col-start-3 lg:row-start-1 lg:block`}
                >
                  <TemplatePreview
                    preview={preview}
                    isPreviewing={isPreviewing}
                    onRefresh={handlePreview}
                    members={members}
                    isLoadingMembers={isLoadingMembers}
                    isDirty={draft.isDirty}
                  />
                </div>
              </>
            ) : (
              <div className="card p-12 text-center lg:col-span-2">
                <Mail className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">Select a Template</h3>
                <p className="text-theme-text-secondary">
                  Choose a template from the list to edit its content and preview the result.
                </p>
              </div>
            )}
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
      </>
    </SettingsLayout>
  );
};

export default EmailTemplatesPage;
