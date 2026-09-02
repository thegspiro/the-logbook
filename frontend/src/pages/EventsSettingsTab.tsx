/**
 * Events Settings Tab
 *
 * Allows event administrators to configure event module settings:
 * - Event type visibility (primary tabs vs. grouped under "Other")
 * - Custom event categories (organization-defined)
 * - Outreach event types (configurable per department)
 * - Request pipeline settings (lead time, default assignee, task reorder, visibility)
 * - Email trigger configuration + template management
 * - Public event request form generation
 *
 * Sections are organized into a sidebar + content panel layout matching
 * the Organization Settings page.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import {
  Settings,
  Loader2,
  FileText,
  ExternalLink,
  ClipboardList,
  Clock,
  Mail,
  Tag,
  LayoutGrid,
  Users,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService, userService } from '../services/api';
import type { EventModuleSettings, EventType, EventCategoryConfig, EmailTemplate } from '../types/event';
import {
  VisibilitySection,
  CategoriesSection,
  OutreachSection,
  HourTrackingSection,
  AttendanceSection,
  PipelineSection,
  EmailSection,
  FormSection,
} from './events-settings';
import type { OrgMember, EventRequestFormSummary } from './events-settings';
import { SettingsLayout, type SettingsSection } from '../components/settings/SettingsLayout';
import { useSettingsAutosave } from '../hooks/useSettingsAutosave';
import { AdminMetricsSettings } from '../components/admin';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a human label to a slug: "Fire Safety Demo" → "fire_safety_demo" */
const toSlug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const DEFAULT_CATEGORY_COLOR = 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';

// ─── Section Definitions ───────────────────────────────────────────────────────

type SectionKey =
  'visibility' | 'categories' | 'attendance' | 'outreach' | 'hour_tracking' | 'pipeline' | 'email' | 'form' | 'metrics';

const SECTIONS: SettingsSection<SectionKey>[] = [
  { key: 'visibility', label: 'Visibility', icon: Settings, description: 'Primary filter categories' },
  { key: 'categories', label: 'Categories', icon: Tag, description: 'Custom event categories' },
  { key: 'attendance', label: 'Attendance', icon: Users, description: "Who can see who's going" },
  { key: 'outreach', label: 'Outreach Types', icon: FileText, description: 'Public outreach event types' },
  { key: 'hour_tracking', label: 'Hour Tracking', icon: Clock, description: 'Map events to admin hours' },
  { key: 'pipeline', label: 'Pipeline', icon: ClipboardList, description: 'Request processing config' },
  { key: 'email', label: 'Email', icon: Mail, description: 'Triggers and email templates' },
  { key: 'form', label: 'Public Form', icon: ExternalLink, description: 'Public event request form' },
  { key: 'metrics', label: 'Headline Metrics', icon: LayoutGrid, description: 'The four cards above this page' },
];

// ─── Main Component ─────────────────────────────────────────────────────────────

interface EventsSettingsTabProps {
  /** Called after the headline metrics save, so the frame above can refetch. */
  onMetricsSaved?: (() => void) | undefined;
}

const EventsSettingsTab: React.FC<EventsSettingsTabProps> = ({ onMetricsSaved }) => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SectionKey>('visibility');
  const [settings, setSettings] = useState<EventModuleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { saveState, save, retry } = useSettingsAutosave();
  const [error, setError] = useState<string | null>(null);

  // Org members for default assignee picker
  const [members, setMembers] = useState<OrgMember[]>([]);

  // Outreach type editing
  const [newTypeLabel, setNewTypeLabel] = useState('');
  const [newRoleLabel, setNewRoleLabel] = useState('');

  // Custom event category editing
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState(DEFAULT_CATEGORY_COLOR);

  // Pipeline task editing
  const [newTaskLabel, setNewTaskLabel] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');

  // Email templates
  const [emailTemplates, setEmailTemplates] = useState<EmailTemplate[]>([]);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateSubject, setNewTemplateSubject] = useState('');
  const [newTemplateBody, setNewTemplateBody] = useState('');
  const [newTemplateTrigger, setNewTemplateTrigger] = useState('');

  // Form generation
  const [generatingForm, setGeneratingForm] = useState(false);
  const [eventRequestForms, setEventRequestForms] = useState<EventRequestFormSummary[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);

  // ─── Data Fetching ──────────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, memberList] = await Promise.all([
        eventService.getModuleSettings(),
        userService.getUsers() as Promise<OrgMember[]>,
      ]);
      setSettings(data);
      setMembers(memberList);
    } catch {
      setError('Failed to load event settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const templates = await eventRequestService.listEmailTemplates();
        setEmailTemplates(templates);
      } catch {
        // Silently fail
      }
    };
    void fetchTemplates();
  }, []);

  const fetchEventRequestForms = useCallback(async () => {
    try {
      setLoadingForms(true);
      const response = await eventRequestService.getForms({ limit: 50 });
      setEventRequestForms(response.forms);
    } catch {
      // Silently fail — the list is supplemental
    } finally {
      setLoadingForms(false);
    }
  }, []);

  useEffect(() => {
    void fetchEventRequestForms();
  }, [fetchEventRequestForms]);

  // ─── Save Helper ───────────────────────────────────────────────────────────

  /**
   * Every control on this screen writes on change, and the header pill is the
   * single report of whether it stuck. There is deliberately no success toast:
   * this screen used to fire one per switch, which meant a member flipping four
   * visibility toggles got four stacked confirmations and would have missed a
   * real failure in among them.
   */
  const saveSettings = async (
    patch: Partial<EventModuleSettings>,
    errorMsg = 'Failed to update setting.'
  ): Promise<EventModuleSettings | null> => {
    if (!settings) return null;
    setSaving(true);
    try {
      // The state update lives *inside* the saver so a retry from the status
      // pill redoes it too. Applying the response outside would leave a
      // successful retry writing the server while the switch it came from
      // stayed visibly unchanged.
      return await save(
        async () => {
          const result = await eventService.updateModuleSettings(patch);
          setSettings(result);
          return result;
        },
        { errorMessage: errorMsg }
      );
    } finally {
      setSaving(false);
    }
  };

  const savePipeline = (pipelinePatch: Partial<EventModuleSettings['request_pipeline']>, errorMsg?: string) =>
    saveSettings(
      {
        request_pipeline: {
          ...(settings?.request_pipeline ?? ({} as EventModuleSettings['request_pipeline'])),
          ...pipelinePatch,
        },
      },
      errorMsg
    );

  // ─── Event Type Visibility ──────────────────────────────────────────────────

  const toggleVisibility = (eventType: EventType) => {
    if (!settings) return;
    const current = settings.visible_event_types;
    const isVisible = current.includes(eventType);

    if (eventType === 'other' && isVisible) {
      toast.error('"Other" must always remain visible as the catch-all category.');
      return;
    }

    const updated = isVisible ? current.filter((t) => t !== eventType) : [...current, eventType];

    void saveSettings({ visible_event_types: updated });
  };

  const setAttendeeVisibility = (value: 'members' | 'managers') => {
    if (!settings) return;
    // The whole `defaults` block is sent back, not just the one key: the
    // backend shallow-merges each settings section, so this is safe, and
    // sending the block keeps the patch shape identical to what the API
    // returned.
    void saveSettings(
      { defaults: { ...settings.defaults, attendee_visibility: value } },
      'Failed to update attendee list visibility.'
    );
  };

  const toggleCategoryVisibility = (categoryValue: string) => {
    if (!settings) return;
    const current = settings.visible_custom_categories || [];
    const isVisible = current.includes(categoryValue);
    const updated = isVisible ? current.filter((v) => v !== categoryValue) : [...current, categoryValue];

    void saveSettings({ visible_custom_categories: updated });
  };

  // ─── Custom Event Categories ────────────────────────────────────────────────

  const addCustomCategory = async () => {
    if (!settings) return;
    const label = newCategoryLabel.trim();
    if (!label) {
      toast.error('Category name is required.');
      return;
    }

    const value = toSlug(label);
    const existing = settings.custom_event_categories || [];
    if (existing.some((c) => c.value === value)) {
      toast.error('A category with that name already exists.');
      return;
    }

    const updated: EventCategoryConfig[] = [...existing, { value, label, color: newCategoryColor }];
    const result = await saveSettings({ custom_event_categories: updated }, 'Failed to add category.');
    if (result) {
      setNewCategoryLabel('');
      setNewCategoryColor(DEFAULT_CATEGORY_COLOR);
    }
  };

  const removeCustomCategory = (categoryValue: string) => {
    if (!settings) return;
    const existing = settings.custom_event_categories || [];
    // Also remove from visible list so deleted slugs don't linger
    void saveSettings(
      {
        custom_event_categories: existing.filter((c) => c.value !== categoryValue),
        visible_custom_categories: (settings.visible_custom_categories || []).filter((v) => v !== categoryValue),
      },
      'Failed to remove category.'
    );
  };

  // ─── Outreach Event Types ──────────────────────────────────────────────────

  const addOutreachType = async () => {
    if (!settings) return;
    const label = newTypeLabel.trim();
    if (!label) {
      toast.error('Type name is required.');
      return;
    }

    const value = toSlug(label);
    if (settings.outreach_event_types.some((t) => t.value === value)) {
      toast.error('An outreach type with that name already exists.');
      return;
    }

    const result = await saveSettings(
      { outreach_event_types: [...settings.outreach_event_types, { value, label }] },
      'Failed to add outreach type.'
    );
    if (result) setNewTypeLabel('');
  };

  const removeOutreachType = (typeValue: string) => {
    if (!settings) return;
    if (typeValue === 'other') {
      toast.error('"Other" cannot be removed.');
      return;
    }
    void saveSettings(
      { outreach_event_types: settings.outreach_event_types.filter((t) => t.value !== typeValue) },
      'Failed to remove outreach type.'
    );
  };

  // ─── Outreach Roles ───────────────────────────────────────────────────────

  const addOutreachRole = async () => {
    if (!settings) return;
    const label = newRoleLabel.trim();
    if (!label) {
      toast.error('Role name is required.');
      return;
    }

    const value = toSlug(label);
    if (settings.outreach_roles.some((r) => r.value === value)) {
      toast.error('An outreach role with that name already exists.');
      return;
    }

    const result = await saveSettings(
      { outreach_roles: [...settings.outreach_roles, { value, label }] },
      'Failed to add outreach role.'
    );
    if (result) setNewRoleLabel('');
  };

  const removeOutreachRole = (roleValue: string) => {
    if (!settings) return;
    void saveSettings(
      { outreach_roles: settings.outreach_roles.filter((r) => r.value !== roleValue) },
      'Failed to remove outreach role.'
    );
  };

  // ─── Request Pipeline ─────────────────────────────────────────────────────

  const updateLeadTime = (days: number) => {
    void savePipeline({ min_lead_time_days: days }, 'Failed to update lead time.');
  };

  const updateDefaultAssignee = (userId: string | null) => {
    void savePipeline({ default_assignee_id: userId }, 'Failed to update default assignee.');
  };

  const toggleAcceptPublicRequests = () => {
    if (!settings) return;
    void savePipeline(
      { accept_public_requests: !settings.request_pipeline.accept_public_requests },
      'Failed to update public request intake.'
    );
  };

  const togglePublicVisibility = () => {
    if (!settings) return;
    void savePipeline(
      { public_progress_visible: !settings.request_pipeline.public_progress_visible },
      'Failed to update visibility.'
    );
  };

  const addPipelineTask = async () => {
    if (!settings) return;
    const label = newTaskLabel.trim();
    const description = newTaskDesc.trim();
    if (!label) {
      toast.error('Task label is required.');
      return;
    }

    const id = toSlug(label);
    if (settings.request_pipeline.tasks.some((t) => t.id === id)) {
      toast.error('A task with that ID already exists.');
      return;
    }

    const updated = [...settings.request_pipeline.tasks, { id, label, description: description || label }];
    const result = await savePipeline({ tasks: updated }, 'Failed to add task.');
    if (result) {
      setNewTaskLabel('');
      setNewTaskDesc('');
    }
  };

  const removePipelineTask = (taskId: string) => {
    if (!settings) return;
    void savePipeline(
      { tasks: settings.request_pipeline.tasks.filter((t) => t.id !== taskId) },
      'Failed to remove task.'
    );
  };

  const reorderTask = (index: number, direction: 'up' | 'down') => {
    if (!settings) return;
    const tasks = [...settings.request_pipeline.tasks];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= tasks.length) return;

    const temp = tasks[index];
    const swapItem = tasks[swapIndex];
    if (!temp || !swapItem) return;
    tasks[index] = swapItem;
    tasks[swapIndex] = temp;

    void savePipeline({ tasks }, 'Failed to reorder tasks.');
  };

  // ─── Email Triggers & Templates ───────────────────────────────────────────

  const toggleEmailTrigger = (triggerKey: string) => {
    if (!settings) return;
    const triggers = { ...settings.request_pipeline.email_triggers };
    const current = triggers[triggerKey] || { enabled: false };
    triggers[triggerKey] = { ...current, enabled: !current.enabled };

    void savePipeline({ email_triggers: triggers }, 'Failed to update email trigger.');
  };

  const handleCreateTemplate = async () => {
    if (!newTemplateName.trim() || !newTemplateSubject.trim() || !newTemplateBody.trim()) {
      toast.error('Name, subject, and body are required.');
      return;
    }

    try {
      setSaving(true);
      const template = await eventRequestService.createEmailTemplate({
        name: newTemplateName.trim(),
        subject: newTemplateSubject.trim(),
        body_html: newTemplateBody.trim(),
        trigger: newTemplateTrigger || undefined,
      });
      setEmailTemplates((prev) => [...prev, template]);
      setNewTemplateName('');
      setNewTemplateSubject('');
      setNewTemplateBody('');
      setNewTemplateTrigger('');
      setShowTemplateForm(false);
      toast.success('Email template created.');
    } catch {
      toast.error('Failed to create template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    try {
      await eventRequestService.deleteEmailTemplate(templateId);
      setEmailTemplates((prev) => prev.filter((t) => t.id !== templateId));
      toast.success('Template deleted.');
    } catch {
      toast.error('Failed to delete template.');
    }
  };

  // ─── Public Form ──────────────────────────────────────────────────────────

  const handleGenerateForm = async () => {
    try {
      setGeneratingForm(true);
      const result = await eventRequestService.generateForm();
      toast.success('Event request form created!');
      toast(`Public URL: ${window.location.origin}${result.public_url}`, { duration: 8000 });
      void fetchEventRequestForms();
    } catch {
      toast.error('Failed to generate form. It may already exist.');
    } finally {
      setGeneratingForm(false);
    }
  };

  // ─── Loading / Error States ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
          <p className="text-red-700 dark:text-red-300">{error || 'Failed to load settings.'}</p>
          <button
            onClick={() => void fetchSettings()}
            className="mt-2 text-sm text-red-700 underline hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ─── Section Content ──────────────────────────────────────────────────────

  const renderContent = () => {
    switch (activeSection) {
      case 'visibility':
        return (
          <VisibilitySection
            settings={settings}
            saving={saving}
            onToggleVisibility={(et) => void toggleVisibility(et)}
            onToggleCategoryVisibility={(cv) => void toggleCategoryVisibility(cv)}
          />
        );
      case 'categories':
        return (
          <CategoriesSection
            settings={settings}
            saving={saving}
            onAddCategory={() => void addCustomCategory()}
            onRemoveCategory={(v) => void removeCustomCategory(v)}
            newCategoryLabel={newCategoryLabel}
            onNewCategoryLabelChange={setNewCategoryLabel}
            newCategoryColor={newCategoryColor}
            onNewCategoryColorChange={setNewCategoryColor}
          />
        );
      case 'outreach':
        return (
          <OutreachSection
            settings={settings}
            saving={saving}
            onAddType={() => void addOutreachType()}
            onRemoveType={(v) => void removeOutreachType(v)}
            newTypeLabel={newTypeLabel}
            onNewTypeLabelChange={setNewTypeLabel}
            onAddRole={() => void addOutreachRole()}
            onRemoveRole={(v) => void removeOutreachRole(v)}
            newRoleLabel={newRoleLabel}
            onNewRoleLabelChange={setNewRoleLabel}
          />
        );
      case 'attendance':
        return (
          <AttendanceSection
            settings={settings}
            saving={saving}
            onChangeAttendeeVisibility={(value) => void setAttendeeVisibility(value)}
          />
        );
      case 'hour_tracking':
        return <HourTrackingSection settings={settings} />;
      case 'pipeline':
        return (
          <PipelineSection
            settings={settings}
            saving={saving}
            members={members}
            onUpdateLeadTime={(d) => void updateLeadTime(d)}
            onUpdateDefaultAssignee={(u) => void updateDefaultAssignee(u)}
            onTogglePublicVisibility={() => void togglePublicVisibility()}
            onToggleAcceptPublicRequests={() => void toggleAcceptPublicRequests()}
            onAddTask={() => void addPipelineTask()}
            onRemoveTask={(id) => void removePipelineTask(id)}
            onReorderTask={(i, d) => void reorderTask(i, d)}
            newTaskLabel={newTaskLabel}
            onNewTaskLabelChange={setNewTaskLabel}
            newTaskDesc={newTaskDesc}
            onNewTaskDescChange={setNewTaskDesc}
          />
        );
      case 'email':
        return (
          <EmailSection
            settings={settings}
            saving={saving}
            emailTemplates={emailTemplates}
            showTemplateForm={showTemplateForm}
            onToggleTemplateForm={setShowTemplateForm}
            onToggleEmailTrigger={(k) => void toggleEmailTrigger(k)}
            onCreateTemplate={() => void handleCreateTemplate()}
            onDeleteTemplate={(id) => void handleDeleteTemplate(id)}
            newTemplateName={newTemplateName}
            onNewTemplateNameChange={setNewTemplateName}
            newTemplateSubject={newTemplateSubject}
            onNewTemplateSubjectChange={setNewTemplateSubject}
            newTemplateBody={newTemplateBody}
            onNewTemplateBodyChange={setNewTemplateBody}
            newTemplateTrigger={newTemplateTrigger}
            onNewTemplateTriggerChange={setNewTemplateTrigger}
          />
        );
      case 'metrics':
        return (
          <AdminMetricsSettings
            moduleKey="events"
            moduleLabel="Events"
            permission="events.manage"
            onSaved={onMetricsSaved}
          />
        );
      case 'form':
        return (
          <FormSection
            generatingForm={generatingForm}
            onGenerateForm={() => void handleGenerateForm()}
            onNavigateToForms={() => void navigate('/forms')}
            eventRequestForms={eventRequestForms}
            loadingForms={loadingForms}
          />
        );
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <SettingsLayout<SectionKey>
      sections={SECTIONS}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      navLabel="Event settings sections"
      title="Event Settings"
      subtitle="How the events module behaves for this department"
      saveState={saveState}
      onRetrySave={retry}
    >
      {renderContent()}
    </SettingsLayout>
  );
};

export default EventsSettingsTab;
