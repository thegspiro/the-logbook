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
import { useNavigate } from 'react-router-dom';
import {
  Settings,
  Loader2,
  FileText,
  ExternalLink,
  ClipboardList,
  Clock,
  Mail,
  Tag,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService, userService, formsService } from '../services/api';
import type { EventModuleSettings, EventType, EventCategoryConfig, EmailTemplate } from '../types/event';
import { getEventTypeLabel } from '../utils/eventHelpers';
import {
  VisibilitySection,
  CategoriesSection,
  OutreachSection,
  HourTrackingSection,
  PipelineSection,
  EmailSection,
  FormSection,
} from './events-settings';
import type { OrgMember, EventRequestFormSummary } from './events-settings';

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Convert a human label to a slug: "Fire Safety Demo" → "fire_safety_demo" */
const toSlug = (label: string): string =>
  label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

const DEFAULT_CATEGORY_COLOR = 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400';

// ─── Section Definitions ───────────────────────────────────────────────────────

type SectionKey = 'visibility' | 'categories' | 'outreach' | 'hour_tracking' | 'pipeline' | 'email' | 'form';

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'visibility', label: 'Visibility', icon: Settings, description: 'Primary filter categories' },
  { key: 'categories', label: 'Categories', icon: Tag, description: 'Custom event categories' },
  { key: 'outreach', label: 'Outreach Types', icon: FileText, description: 'Public outreach event types' },
  { key: 'hour_tracking', label: 'Hour Tracking', icon: Clock, description: 'Map events to admin hours' },
  { key: 'pipeline', label: 'Pipeline', icon: ClipboardList, description: 'Request processing config' },
  { key: 'email', label: 'Email', icon: Mail, description: 'Triggers and email templates' },
  { key: 'form', label: 'Public Form', icon: ExternalLink, description: 'Public event request form' },
];


// ─── Main Component ─────────────────────────────────────────────────────────────

const EventsSettingsTab: React.FC = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SectionKey>('visibility');
  const [settings, setSettings] = useState<EventModuleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Org members for default assignee picker
  const [members, setMembers] = useState<OrgMember[]>([]);

  // Outreach type editing
  const [newTypeLabel, setNewTypeLabel] = useState('');

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
      const response = await formsService.getForms({ limit: 50 });
      const filtered = response.forms.filter(
        (f) => f.integration_type === 'event_request'
      );
      setEventRequestForms(filtered);
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

  const saveSettings = async (
    patch: Partial<EventModuleSettings>,
    successMsg?: string,
    errorMsg = 'Failed to update setting.',
  ): Promise<EventModuleSettings | null> => {
    if (!settings) return null;
    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings(patch);
      setSettings(result);
      if (successMsg) toast.success(successMsg);
      return result;
    } catch {
      toast.error(errorMsg);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const savePipeline = (
    pipelinePatch: Partial<EventModuleSettings['request_pipeline']>,
    successMsg?: string,
    errorMsg?: string,
  ) => saveSettings(
    { request_pipeline: { ...(settings?.request_pipeline ?? {} as EventModuleSettings['request_pipeline']), ...pipelinePatch } },
    successMsg,
    errorMsg,
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

    const updated = isVisible
      ? current.filter((t) => t !== eventType)
      : [...current, eventType];

    void saveSettings(
      { visible_event_types: updated },
      isVisible
        ? `${getEventTypeLabel(eventType)} moved to "Other" category`
        : `${getEventTypeLabel(eventType)} is now a primary category`,
    );
  };

  const toggleCategoryVisibility = (categoryValue: string) => {
    if (!settings) return;
    const current = settings.visible_custom_categories || [];
    const isVisible = current.includes(categoryValue);
    const updated = isVisible
      ? current.filter((v) => v !== categoryValue)
      : [...current, categoryValue];

    const cat = (settings.custom_event_categories || []).find((c) => c.value === categoryValue);
    const name = cat?.label || categoryValue;

    void saveSettings(
      { visible_custom_categories: updated },
      isVisible ? `"${name}" hidden from primary filters` : `"${name}" is now a primary filter`,
    );
  };

  // ─── Custom Event Categories ────────────────────────────────────────────────

  const addCustomCategory = async () => {
    if (!settings) return;
    const label = newCategoryLabel.trim();
    if (!label) { toast.error('Category name is required.'); return; }

    const value = toSlug(label);
    const existing = settings.custom_event_categories || [];
    if (existing.some((c) => c.value === value)) {
      toast.error('A category with that name already exists.');
      return;
    }

    const updated: EventCategoryConfig[] = [...existing, { value, label, color: newCategoryColor }];
    const result = await saveSettings(
      { custom_event_categories: updated },
      `Created "${label}" category.`,
      'Failed to add category.',
    );
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
        visible_custom_categories: (settings.visible_custom_categories || []).filter(
          (v) => v !== categoryValue
        ),
      },
      'Category removed.',
      'Failed to remove category.',
    );
  };

  // ─── Outreach Event Types ──────────────────────────────────────────────────

  const addOutreachType = async () => {
    if (!settings) return;
    const label = newTypeLabel.trim();
    if (!label) { toast.error('Type name is required.'); return; }

    const value = toSlug(label);
    if (settings.outreach_event_types.some((t) => t.value === value)) {
      toast.error('An outreach type with that name already exists.');
      return;
    }

    const result = await saveSettings(
      { outreach_event_types: [...settings.outreach_event_types, { value, label }] },
      `Added "${label}" outreach type.`,
      'Failed to add outreach type.',
    );
    if (result) setNewTypeLabel('');
  };

  const removeOutreachType = (typeValue: string) => {
    if (!settings) return;
    if (typeValue === 'other') { toast.error('"Other" cannot be removed.'); return; }
    void saveSettings(
      { outreach_event_types: settings.outreach_event_types.filter((t) => t.value !== typeValue) },
      'Outreach type removed.',
      'Failed to remove outreach type.',
    );
  };

  // ─── Request Pipeline ─────────────────────────────────────────────────────

  const updateLeadTime = (days: number) => {
    void savePipeline({ min_lead_time_days: days }, `Minimum lead time set to ${days} days.`, 'Failed to update lead time.');
  };

  const updateDefaultAssignee = (userId: string | null) => {
    void savePipeline(
      { default_assignee_id: userId },
      userId ? 'Default assignee updated.' : 'Default assignee cleared.',
      'Failed to update default assignee.',
    );
  };

  const togglePublicVisibility = async () => {
    if (!settings) return;
    const result = await savePipeline(
      { public_progress_visible: !settings.request_pipeline.public_progress_visible },
      undefined,
      'Failed to update visibility.',
    );
    if (result) {
      toast.success(
        result.request_pipeline.public_progress_visible
          ? 'Pipeline progress is now visible to requesters.'
          : 'Pipeline progress is now hidden from requesters.'
      );
    }
  };

  const addPipelineTask = async () => {
    if (!settings) return;
    const label = newTaskLabel.trim();
    const description = newTaskDesc.trim();
    if (!label) { toast.error('Task label is required.'); return; }

    const id = toSlug(label);
    if (settings.request_pipeline.tasks.some((t) => t.id === id)) {
      toast.error('A task with that ID already exists.');
      return;
    }

    const updated = [...settings.request_pipeline.tasks, { id, label, description: description || label }];
    const result = await savePipeline({ tasks: updated }, `Added "${label}" task.`, 'Failed to add task.');
    if (result) { setNewTaskLabel(''); setNewTaskDesc(''); }
  };

  const removePipelineTask = (taskId: string) => {
    if (!settings) return;
    void savePipeline(
      { tasks: settings.request_pipeline.tasks.filter((t) => t.id !== taskId) },
      'Pipeline task removed.',
      'Failed to remove task.',
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

    void savePipeline({ tasks }, undefined, 'Failed to reorder tasks.');
  };

  // ─── Email Triggers & Templates ───────────────────────────────────────────

  const toggleEmailTrigger = (triggerKey: string) => {
    if (!settings) return;
    const triggers = { ...settings.request_pipeline.email_triggers };
    const current = triggers[triggerKey] || { enabled: false };
    triggers[triggerKey] = { ...current, enabled: !current.enabled };

    void savePipeline({ email_triggers: triggers }, undefined, 'Failed to update email trigger.');
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
      <div className="min-h-[50vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4" role="alert">
          <p className="text-red-700 dark:text-red-300">{error || 'Failed to load settings.'}</p>
          <button
            onClick={() => void fetchSettings()}
            className="mt-2 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 underline"
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
          />
        );
      case 'hour_tracking':
        return (
          <HourTrackingSection settings={settings} />
        );
      case 'pipeline':
        return (
          <PipelineSection
            settings={settings}
            saving={saving}
            members={members}
            onUpdateLeadTime={(d) => void updateLeadTime(d)}
            onUpdateDefaultAssignee={(u) => void updateDefaultAssignee(u)}
            onTogglePublicVisibility={() => void togglePublicVisibility()}
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
      case 'form':
        return (
          <FormSection
            generatingForm={generatingForm}
            onGenerateForm={() => void handleGenerateForm()}
            onNavigateToForms={() => navigate('/forms')}
            eventRequestForms={eventRequestForms}
            loadingForms={loadingForms}
          />
        );
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col md:flex-row gap-6">
        {/* Mobile: horizontal scrollable tabs */}
        <nav className="md:hidden -mx-4 px-4 border-b border-theme-surface-border" aria-label="Event settings sections">
          <div className="flex overflow-x-auto scrollbar-thin scroll-smooth gap-1 pb-2">
            {SECTIONS.map(({ key, label, icon: Icon }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap text-sm font-medium transition-colors focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring ${
                    isActive
                      ? 'bg-theme-accent-blue-muted text-theme-accent-blue'
                      : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                  {label}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Desktop: sidebar */}
        <nav className="hidden md:block md:w-56 shrink-0" aria-label="Event settings sections">
          <div className="md:sticky md:top-24 space-y-1">
            {SECTIONS.map(({ key, label, icon: Icon, description }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className={`w-full flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring ${
                    isActive
                      ? 'bg-theme-accent-blue-muted text-theme-accent-blue'
                      : 'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${isActive ? '' : 'text-theme-text-muted'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className={`text-xs ${isActive ? 'text-theme-accent-blue/70' : 'text-theme-text-muted'}`}>
                      {description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Content panel */}
        <main className="flex-1 min-w-0">
          <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-4 sm:p-6">
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default EventsSettingsTab;
