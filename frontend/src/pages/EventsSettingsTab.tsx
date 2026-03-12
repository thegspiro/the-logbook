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
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Trash2,
  FileText,
  ExternalLink,
  ClipboardList,
  Calendar,
  ChevronUp,
  ChevronDown,
  Mail,
  UserCheck,
  Globe,
  Tag,
  Palette,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService, userService } from '../services/api';
import type {
  EventModuleSettings,
  EventType,
  EventCategoryConfig,
  OutreachEventTypeConfig,
  PipelineTaskConfig,
  EmailTemplate,
} from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';
import { EventType as EventTypeEnum } from '../constants/enums';

const ALL_EVENT_TYPES: EventType[] = [
  EventTypeEnum.BUSINESS_MEETING,
  EventTypeEnum.PUBLIC_EDUCATION,
  EventTypeEnum.TRAINING,
  EventTypeEnum.SOCIAL,
  EventTypeEnum.FUNDRAISER,
  EventTypeEnum.CEREMONY,
  EventTypeEnum.OTHER,
];

const CATEGORY_COLOR_OPTIONS = [
  { value: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400', label: 'Blue', preview: 'bg-blue-500' },
  { value: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400', label: 'Green', preview: 'bg-green-500' },
  { value: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400', label: 'Purple', preview: 'bg-purple-500' },
  { value: 'bg-pink-100 text-pink-800 dark:bg-pink-500/20 dark:text-pink-400', label: 'Pink', preview: 'bg-pink-500' },
  { value: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400', label: 'Yellow', preview: 'bg-yellow-500' },
  { value: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400', label: 'Indigo', preview: 'bg-indigo-500' },
  { value: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400', label: 'Red', preview: 'bg-red-500' },
  { value: 'bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-400', label: 'Teal', preview: 'bg-teal-500' },
  { value: 'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-400', label: 'Orange', preview: 'bg-orange-500' },
] as const;

type CategoryColor = (typeof CATEGORY_COLOR_OPTIONS)[number]['value'];
const DEFAULT_CATEGORY_COLOR: CategoryColor = CATEGORY_COLOR_OPTIONS[0].value;

interface OrgMember {
  id: string;
  first_name: string;
  last_name: string;
  rank?: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  on_submitted: 'New request submitted',
  on_in_progress: 'Request work started',
  on_scheduled: 'Request scheduled',
  on_postponed: 'Request postponed',
  on_completed: 'Event completed',
  on_declined: 'Request declined',
  on_cancelled: 'Request cancelled',
  days_before_event: 'Days before event reminder',
};

// ─── Section Definitions ───────────────────────────────────────────────────────

type SectionKey = 'visibility' | 'categories' | 'outreach' | 'pipeline' | 'email' | 'form';

const SECTIONS: { key: SectionKey; label: string; icon: React.ElementType; description: string }[] = [
  { key: 'visibility', label: 'Visibility', icon: Settings, description: 'Primary filter categories' },
  { key: 'categories', label: 'Categories', icon: Tag, description: 'Custom event categories' },
  { key: 'outreach', label: 'Outreach Types', icon: FileText, description: 'Public outreach event types' },
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
  const [newCategoryColor, setNewCategoryColor] = useState<CategoryColor>(DEFAULT_CATEGORY_COLOR);

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

  // ─── Event Type Visibility ──────────────────────────────────────────────────

  const toggleVisibility = async (eventType: EventType) => {
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

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        visible_event_types: updated,
      });
      setSettings(result);
      toast.success(
        isVisible
          ? `${getEventTypeLabel(eventType)} moved to "Other" category`
          : `${getEventTypeLabel(eventType)} is now a primary category`
      );
    } catch {
      toast.error('Failed to update setting.');
    } finally {
      setSaving(false);
    }
  };

  const toggleCategoryVisibility = async (categoryValue: string) => {
    if (!settings) return;

    const current = settings.visible_custom_categories || [];
    const isVisible = current.includes(categoryValue);
    const updated = isVisible
      ? current.filter((v) => v !== categoryValue)
      : [...current, categoryValue];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        visible_custom_categories: updated,
      });
      setSettings(result);
      const cat = (settings.custom_event_categories || []).find((c) => c.value === categoryValue);
      const name = cat?.label || categoryValue;
      toast.success(
        isVisible
          ? `"${name}" hidden from primary filters`
          : `"${name}" is now a primary filter`
      );
    } catch {
      toast.error('Failed to update setting.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Custom Event Categories ────────────────────────────────────────────────

  const addCustomCategory = async () => {
    if (!settings) return;
    const label = newCategoryLabel.trim();
    if (!label) {
      toast.error('Category name is required.');
      return;
    }

    const value = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const existing = settings.custom_event_categories || [];

    if (existing.some((c) => c.value === value)) {
      toast.error('A category with that name already exists.');
      return;
    }

    const updated: EventCategoryConfig[] = [...existing, { value, label, color: newCategoryColor }];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        custom_event_categories: updated,
      });
      setSettings(result);
      setNewCategoryLabel('');
      setNewCategoryColor(DEFAULT_CATEGORY_COLOR);
      toast.success(`Created "${label}" category.`);
    } catch {
      toast.error('Failed to add category.');
    } finally {
      setSaving(false);
    }
  };

  const removeCustomCategory = async (categoryValue: string) => {
    if (!settings) return;
    const existing = settings.custom_event_categories || [];
    const updated = existing.filter((c) => c.value !== categoryValue);

    // Also remove from visible list so deleted slugs don't linger
    const updatedVisible = (settings.visible_custom_categories || []).filter(
      (v) => v !== categoryValue
    );

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        custom_event_categories: updated,
        visible_custom_categories: updatedVisible,
      });
      setSettings(result);
      toast.success('Category removed.');
    } catch {
      toast.error('Failed to remove category.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Outreach Event Types ──────────────────────────────────────────────────

  const addOutreachType = async () => {
    if (!settings) return;
    const label = newTypeLabel.trim();
    if (!label) {
      toast.error('Type name is required.');
      return;
    }

    const value = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    if (settings.outreach_event_types.some((t) => t.value === value)) {
      toast.error('An outreach type with that name already exists.');
      return;
    }

    const updated = [...settings.outreach_event_types, { value, label }];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        outreach_event_types: updated,
      });
      setSettings(result);
      setNewTypeLabel('');
      toast.success(`Added "${label}" outreach type.`);
    } catch {
      toast.error('Failed to add outreach type.');
    } finally {
      setSaving(false);
    }
  };

  const removeOutreachType = async (typeValue: string) => {
    if (!settings) return;

    if (typeValue === 'other') {
      toast.error('"Other" cannot be removed.');
      return;
    }

    const updated = settings.outreach_event_types.filter((t) => t.value !== typeValue);

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        outreach_event_types: updated,
      });
      setSettings(result);
      toast.success('Outreach type removed.');
    } catch {
      toast.error('Failed to remove outreach type.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Request Pipeline ─────────────────────────────────────────────────────

  const updateLeadTime = async (days: number) => {
    if (!settings) return;

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, min_lead_time_days: days },
      });
      setSettings(result);
      toast.success(`Minimum lead time set to ${days} days.`);
    } catch {
      toast.error('Failed to update lead time.');
    } finally {
      setSaving(false);
    }
  };

  const updateDefaultAssignee = async (userId: string | null) => {
    if (!settings) return;

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, default_assignee_id: userId },
      });
      setSettings(result);
      toast.success(userId ? 'Default assignee updated.' : 'Default assignee cleared.');
    } catch {
      toast.error('Failed to update default assignee.');
    } finally {
      setSaving(false);
    }
  };

  const togglePublicVisibility = async () => {
    if (!settings) return;

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: {
          ...settings.request_pipeline,
          public_progress_visible: !settings.request_pipeline.public_progress_visible,
        },
      });
      setSettings(result);
      toast.success(
        result.request_pipeline.public_progress_visible
          ? 'Pipeline progress is now visible to requesters.'
          : 'Pipeline progress is now hidden from requesters.'
      );
    } catch {
      toast.error('Failed to update visibility.');
    } finally {
      setSaving(false);
    }
  };

  const addPipelineTask = async () => {
    if (!settings) return;
    const label = newTaskLabel.trim();
    const description = newTaskDesc.trim();

    if (!label) {
      toast.error('Task label is required.');
      return;
    }

    const id = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (settings.request_pipeline.tasks.some((t) => t.id === id)) {
      toast.error('A task with that ID already exists.');
      return;
    }

    const updated = [...settings.request_pipeline.tasks, { id, label, description: description || label }];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, tasks: updated },
      });
      setSettings(result);
      setNewTaskLabel('');
      setNewTaskDesc('');
      toast.success(`Added "${label}" task.`);
    } catch {
      toast.error('Failed to add task.');
    } finally {
      setSaving(false);
    }
  };

  const removePipelineTask = async (taskId: string) => {
    if (!settings) return;

    const updated = settings.request_pipeline.tasks.filter((t) => t.id !== taskId);

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, tasks: updated },
      });
      setSettings(result);
      toast.success('Pipeline task removed.');
    } catch {
      toast.error('Failed to remove task.');
    } finally {
      setSaving(false);
    }
  };

  const reorderTask = async (index: number, direction: 'up' | 'down') => {
    if (!settings) return;
    const tasks = [...settings.request_pipeline.tasks];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= tasks.length) return;

    const temp = tasks[index];
    const swapItem = tasks[swapIndex];
    if (!temp || !swapItem) return;
    tasks[index] = swapItem;
    tasks[swapIndex] = temp;

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, tasks },
      });
      setSettings(result);
    } catch {
      toast.error('Failed to reorder tasks.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Email Triggers & Templates ───────────────────────────────────────────

  const toggleEmailTrigger = async (triggerKey: string) => {
    if (!settings) return;
    const triggers = { ...settings.request_pipeline.email_triggers };
    const current = triggers[triggerKey] || { enabled: false };
    triggers[triggerKey] = { ...current, enabled: !current.enabled };

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        request_pipeline: { ...settings.request_pipeline, email_triggers: triggers },
      });
      setSettings(result);
    } catch {
      toast.error('Failed to update email trigger.');
    } finally {
      setSaving(false);
    }
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
        trigger: newTemplateTrigger ?? undefined,
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
      toast.success('Event request form created! Redirecting to Forms...');
      toast(
        `Public URL: ${window.location.origin}${result.public_url}`,
        { duration: 8000, icon: '🔗' }
      );
      navigate('/forms');
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

  // ─── Derived Data ─────────────────────────────────────────────────────────

  const visibleTypes = ALL_EVENT_TYPES.filter((t) =>
    settings.visible_event_types.includes(t)
  );
  const hiddenTypes = ALL_EVENT_TYPES.filter(
    (t) => !settings.visible_event_types.includes(t)
  );
  const customCategories = settings.custom_event_categories || [];

  // ─── Section Content ──────────────────────────────────────────────────────

  const renderContent = () => {
    switch (activeSection) {
      // ════════════════════════════════════════════
      // VISIBILITY
      // ════════════════════════════════════════════
      case 'visibility':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Event Type Visibility</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Choose which event types appear as primary filter categories.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Visible Categories
              </h4>
              <div className="space-y-2">
                {visibleTypes.map((eventType) => (
                  <div
                    key={eventType}
                    className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                  >
                    <div className="flex items-center gap-3">
                      <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(eventType)}`}
                      >
                        {getEventTypeLabel(eventType)}
                      </span>
                    </div>
                    {eventType !== 'other' && (
                      <button
                        type="button"
                        onClick={() => void toggleVisibility(eventType)}
                        disabled={saving}
                        className="text-sm text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50 transition-colors"
                        title={`Move "${getEventTypeLabel(eventType)}" to Other`}
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {hiddenTypes.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                  Grouped Under &ldquo;Other&rdquo;
                </h4>
                <div className="space-y-2">
                  {hiddenTypes.map((eventType) => (
                    <div
                      key={eventType}
                      className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border bg-theme-surface-secondary/30"
                    >
                      <div className="flex items-center gap-3">
                        <EyeOff className="w-4 h-4 text-theme-text-muted" />
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getEventTypeBadgeColor(eventType)} opacity-60`}
                        >
                          {getEventTypeLabel(eventType)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleVisibility(eventType)}
                        disabled={saving}
                        className="text-sm text-theme-text-muted hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50 transition-colors"
                        title={`Show "${getEventTypeLabel(eventType)}" as primary category`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Categories visibility */}
            {customCategories.length > 0 && (
              <div className="border-t border-theme-surface-border pt-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                  Custom Categories
                </h4>
                <p className="text-xs text-theme-text-muted mb-3">
                  Toggle visibility of organization-defined categories as primary filter tabs.
                </p>
                <div className="space-y-2">
                  {customCategories.map((cat) => {
                    const isVisible = (settings.visible_custom_categories || []).includes(cat.value);
                    return (
                      <div
                        key={cat.value}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          isVisible
                            ? 'border-theme-surface-border'
                            : 'border-theme-surface-border bg-theme-surface-secondary/30'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {isVisible ? (
                            <Eye className="w-4 h-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-theme-text-muted" />
                          )}
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cat.color} ${
                              isVisible ? '' : 'opacity-60'
                            }`}
                          >
                            {cat.label}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleCategoryVisibility(cat.value)}
                          disabled={saving}
                          className={`text-sm disabled:opacity-50 transition-colors ${
                            isVisible
                              ? 'text-theme-text-muted hover:text-theme-text-primary'
                              : 'text-theme-text-muted hover:text-green-600 dark:hover:text-green-400'
                          }`}
                          title={isVisible ? `Hide "${cat.label}"` : `Show "${cat.label}" as primary filter`}
                        >
                          {isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );

      // ════════════════════════════════════════════
      // CATEGORIES
      // ════════════════════════════════════════════
      case 'categories':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Custom Event Categories</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Create organization-specific event categories beyond the built-in types.
              </p>
            </div>

            {customCategories.length > 0 ? (
              <div className="space-y-2">
                {customCategories.map((cat: EventCategoryConfig) => (
                  <div
                    key={cat.value}
                    className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cat.color}`}
                      >
                        {cat.label}
                      </span>
                      <span className="text-xs text-theme-text-muted font-mono">{cat.value}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeCustomCategory(cat.value)}
                      disabled={saving}
                      className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                      title={`Remove "${cat.label}"`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-theme-text-muted italic py-2 text-center">
                No custom categories yet. Add one below.
              </p>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="new-category-label" className="block text-xs font-medium text-theme-text-muted mb-1">
                  Category Name
                </label>
                <input
                  id="new-category-label"
                  type="text"
                  value={newCategoryLabel}
                  onChange={(e) => setNewCategoryLabel(e.target.value)}
                  placeholder="e.g., Drill, Inspection"
                  className="form-input placeholder-theme-text-muted text-sm"
                />
              </div>
              <div className="w-36">
                <label htmlFor="new-category-color" className="block text-xs font-medium text-theme-text-muted mb-1">
                  <Palette className="w-3 h-3 inline mr-1" />
                  Color
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {CATEGORY_COLOR_OPTIONS.map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setNewCategoryColor(opt.value)}
                      className={`w-5 h-5 rounded-full ${opt.preview} transition-all ${
                        newCategoryColor === opt.value
                          ? 'ring-2 ring-offset-2 ring-theme-focus-ring dark:ring-offset-gray-800'
                          : 'opacity-60 hover:opacity-100'
                      }`}
                      title={opt.label}
                      aria-label={`Select ${opt.label} color`}
                    />
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void addCustomCategory()}
                disabled={saving || !newCategoryLabel.trim()}
                className="btn-primary flex font-medium gap-1.5 items-center text-sm"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // OUTREACH TYPES
      // ════════════════════════════════════════════
      case 'outreach':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Outreach Event Types</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Types of public outreach events shown on the request form.
              </p>
            </div>

            <div className="space-y-2">
              {settings.outreach_event_types.map((ot: OutreachEventTypeConfig) => (
                <div
                  key={ot.value}
                  className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-theme-text-primary">{ot.label}</span>
                    <span className="text-xs text-theme-text-muted font-mono">{ot.value}</span>
                  </div>
                  {ot.value !== 'other' && (
                    <button
                      type="button"
                      onClick={() => void removeOutreachType(ot.value)}
                      disabled={saving}
                      className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                      title={`Remove "${ot.label}"`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="new-outreach-label" className="block text-xs font-medium text-theme-text-muted mb-1">
                  Type Name
                </label>
                <input
                  id="new-outreach-label"
                  type="text"
                  value={newTypeLabel}
                  onChange={(e) => setNewTypeLabel(e.target.value)}
                  placeholder="e.g., School Visit"
                  className="form-input placeholder-theme-text-muted text-sm"
                />
              </div>
              <button
                type="button"
                onClick={() => void addOutreachType()}
                disabled={saving || !newTypeLabel.trim()}
                className="btn-primary flex font-medium gap-1.5 items-center text-sm"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // PIPELINE
      // ════════════════════════════════════════════
      case 'pipeline':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Request Pipeline</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Configure how event requests are processed.
              </p>
            </div>

            {/* Default assignee */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <UserCheck className="w-4 h-4 text-theme-text-muted" />
                <p className="text-sm font-medium text-theme-text-primary">Default Coordinator</p>
              </div>
              <p className="text-xs text-theme-text-muted mb-3">
                All new requests will be auto-assigned to this person.
              </p>
              <select
                value={settings.request_pipeline.default_assignee_id || ''}
                onChange={(e) => void updateDefaultAssignee(e.target.value || null)}
                disabled={saving}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring max-w-md"
              >
                <option value="">No default (manually assign)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.first_name} {m.last_name}{m.rank ? ` — ${m.rank}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Public progress visibility */}
            <div className="flex items-center justify-between py-3 border-t border-theme-surface-border">
              <div>
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-theme-text-muted" />
                  <p className="text-sm font-medium text-theme-text-primary">Public Progress Visibility</p>
                </div>
                <p className="text-xs text-theme-text-muted mt-0.5 ml-6">
                  Show pipeline task progress on the public status page
                </p>
              </div>
              <button
                type="button"
                onClick={() => void togglePublicVisibility()}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                  settings.request_pipeline.public_progress_visible
                    ? 'bg-green-500'
                    : 'bg-theme-surface-hover'
                }`}
                role="switch"
                aria-checked={settings.request_pipeline.public_progress_visible}
                aria-label="Public progress visibility"
              >
                <span
                  className={`toggle-knob-sm ${
                    settings.request_pipeline.public_progress_visible ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {/* Lead time */}
            <div className="border-t border-theme-surface-border pt-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-theme-text-muted" />
                <p className="text-sm font-medium text-theme-text-primary">Minimum Lead Time</p>
              </div>
              <p className="text-xs text-theme-text-muted mb-3">
                How far in advance must requests be submitted?
              </p>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={settings.request_pipeline.min_lead_time_days}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val >= 0 && val <= 365) {
                      void updateLeadTime(val);
                    }
                  }}
                  className="w-20 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-md text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                />
                <span className="text-sm text-theme-text-muted">
                  days ({Math.floor(settings.request_pipeline.min_lead_time_days / 7)} weeks)
                </span>
              </div>
            </div>

            {/* Pipeline tasks with reorder */}
            <div className="border-t border-theme-surface-border pt-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Pipeline Tasks
              </h4>
              <p className="text-xs text-theme-text-muted mb-3">
                Checklist items your team uses when processing requests. Use arrows to reorder.
              </p>
              <div className="space-y-2 mb-4">
                {settings.request_pipeline.tasks.map((task: PipelineTaskConfig, idx: number) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <button
                          type="button"
                          onClick={() => void reorderTask(idx, 'up')}
                          disabled={saving || idx === 0}
                          className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void reorderTask(idx, 'down')}
                          disabled={saving || idx === settings.request_pipeline.tasks.length - 1}
                          className="text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-theme-text-primary">{task.label}</span>
                        {task.description && task.description !== task.label && (
                          <p className="text-xs text-theme-text-muted mt-0.5">{task.description}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void removePipelineTask(task.id)}
                      disabled={saving}
                      className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 transition-colors"
                      title={`Remove "${task.label}"`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {settings.request_pipeline.tasks.length === 0 && (
                  <p className="text-sm text-theme-text-muted italic py-4 text-center">
                    No pipeline tasks configured. Add tasks below.
                  </p>
                )}
              </div>

              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="new-task-label" className="block text-xs font-medium text-theme-text-muted mb-1">
                    Task Name
                  </label>
                  <input
                    id="new-task-label"
                    type="text"
                    value={newTaskLabel}
                    onChange={(e) => setNewTaskLabel(e.target.value)}
                    placeholder="e.g., Chief Approval"
                    className="form-input placeholder-theme-text-muted text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="new-task-desc" className="block text-xs font-medium text-theme-text-muted mb-1">
                    Description (optional)
                  </label>
                  <input
                    id="new-task-desc"
                    type="text"
                    value={newTaskDesc}
                    onChange={(e) => setNewTaskDesc(e.target.value)}
                    placeholder="Brief description of this step"
                    className="form-input placeholder-theme-text-muted text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void addPipelineTask()}
                  disabled={saving || !newTaskLabel.trim()}
                  className="btn-primary flex font-medium gap-1.5 items-center text-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </button>
              </div>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // EMAIL
      // ════════════════════════════════════════════
      case 'email':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Email Configuration</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Notification triggers and reusable email templates.
              </p>
            </div>

            {/* Email Triggers */}
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted mb-2">
                Notification Triggers
              </h4>
              <div className="space-y-2">
                {Object.entries(TRIGGER_LABELS).map(([key, label]) => {
                  const config = settings.request_pipeline.email_triggers[key] || { enabled: false };
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                    >
                      <span className="text-sm font-medium text-theme-text-primary">{label}</span>
                      <button
                        type="button"
                        onClick={() => void toggleEmailTrigger(key)}
                        disabled={saving}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-theme-focus-ring disabled:opacity-50 disabled:cursor-not-allowed ${
                          config.enabled ? 'bg-green-500' : 'bg-theme-surface-hover'
                        }`}
                        role="switch"
                        aria-checked={config.enabled}
                        aria-label={label}
                      >
                        <span
                          className={`toggle-knob-sm ${
                            config.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Email Templates */}
            <div className="border-t border-theme-surface-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-theme-text-muted">
                  Email Templates
                </h4>
                <button
                  type="button"
                  onClick={() => setShowTemplateForm(!showTemplateForm)}
                  className="btn-primary flex font-medium gap-1.5 items-center px-3 py-1.5 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  New Template
                </button>
              </div>
              <p className="text-xs text-theme-text-muted mb-3">
                Reusable email messages for coordinators. Variables: {'{{contact_name}}'}, {'{{outreach_type}}'}, {'{{event_date}}'}.
              </p>

              {showTemplateForm && (
                <div className="mb-4 p-4 space-y-3 rounded-lg border border-theme-surface-border bg-theme-surface-secondary/30">
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="Template name (e.g., How to Find Our Building)"
                    className="form-input placeholder-theme-text-muted text-sm"
                  />
                  <input
                    type="text"
                    value={newTemplateSubject}
                    onChange={(e) => setNewTemplateSubject(e.target.value)}
                    placeholder="Email subject"
                    className="form-input placeholder-theme-text-muted text-sm"
                  />
                  <textarea
                    rows={4}
                    value={newTemplateBody}
                    onChange={(e) => setNewTemplateBody(e.target.value)}
                    placeholder="Email body (HTML supported)"
                    className="form-input placeholder-theme-text-muted text-sm"
                  />
                  <div className="flex items-center gap-3">
                    <select
                      value={newTemplateTrigger}
                      onChange={(e) => setNewTemplateTrigger(e.target.value)}
                      className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
                    >
                      <option value="">Manual send only</option>
                      {Object.entries(TRIGGER_LABELS).map(([key, triggerLabel]) => (
                        <option key={key} value={key}>{triggerLabel}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => void handleCreateTemplate()}
                      disabled={saving}
                      className="btn-primary font-medium text-sm"
                    >
                      Save Template
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTemplateForm(false)}
                      className="px-4 py-2 text-sm font-medium text-theme-text-muted hover:text-theme-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {emailTemplates.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-theme-surface-border"
                  >
                    <div>
                      <span className="text-sm font-medium text-theme-text-primary">{tpl.name}</span>
                      <p className="text-xs text-theme-text-muted mt-0.5">
                        Subject: {tpl.subject}
                        {tpl.trigger && (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                            Auto: {TRIGGER_LABELS[tpl.trigger] || tpl.trigger}
                          </span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTemplate(tpl.id)}
                      className="text-sm text-theme-text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title="Delete template"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {emailTemplates.length === 0 && !showTemplateForm && (
                  <p className="text-sm text-theme-text-muted italic py-4 text-center">
                    No email templates yet. Create one to send standardized messages to requesters.
                  </p>
                )}
              </div>
            </div>
          </div>
        );

      // ════════════════════════════════════════════
      // PUBLIC FORM
      // ════════════════════════════════════════════
      case 'form':
        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-theme-text-primary">Public Event Request Form</h3>
              <p className="text-sm text-theme-text-muted mt-1">
                Generate a public form for community members to request outreach events.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <button
                  type="button"
                  onClick={() => void handleGenerateForm()}
                  disabled={generatingForm}
                  className="btn-primary flex font-medium gap-2 items-center text-sm"
                >
                  {generatingForm ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Generate Event Request Form
                    </>
                  )}
                </button>
                <p className="text-xs text-theme-text-muted mt-2">
                  The form will be created in Draft status and you will be redirected to the Forms page
                  where you can customize fields and styling before publishing.
                </p>
              </div>

              <div className="border-t border-theme-surface-border pt-4">
                <button
                  type="button"
                  onClick={() => navigate('/forms')}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  View all public forms
                </button>
              </div>
            </div>
          </div>
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
