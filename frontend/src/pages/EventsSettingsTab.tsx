/**
 * Events Settings Tab
 *
 * Allows event administrators to configure event module settings:
 * - Event type visibility (primary tabs vs. grouped under "Other")
 * - Outreach event types (configurable per department)
 * - Request pipeline settings (lead time, default assignee, task reorder, visibility)
 * - Email trigger configuration
 * - Email template management
 * - Public event request form generation
 *
 * Shown within the Events Admin Hub.
 */

import React, { useEffect, useState, useCallback } from 'react';
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
} from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService, eventRequestService, userService } from '../services/api';
import type {
  EventModuleSettings,
  EventType,
  OutreachEventTypeConfig,
  PipelineTaskConfig,
  EmailTemplate,
} from '../types/event';
import { getEventTypeLabel, getEventTypeBadgeColor } from '../utils/eventHelpers';

const ALL_EVENT_TYPES: EventType[] = [
  'business_meeting',
  'public_education',
  'training',
  'social',
  'fundraiser',
  'ceremony',
  'other',
];

interface OrgMember {
  id: string;
  first_name: string;
  last_name: string;
  rank?: string;
}

const EventsSettingsTab: React.FC = () => {
  const [settings, setSettings] = useState<EventModuleSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Org members for default assignee picker
  const [members, setMembers] = useState<OrgMember[]>([]);

  // Outreach type editing
  const [newTypeValue, setNewTypeValue] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');

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

  // Fetch email templates
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

  const addOutreachType = async () => {
    if (!settings) return;
    const value = newTypeValue.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const label = newTypeLabel.trim();

    if (!value || !label) {
      toast.error('Both ID and label are required.');
      return;
    }

    if (settings.outreach_event_types.some((t) => t.value === value)) {
      toast.error('An outreach type with that ID already exists.');
      return;
    }

    const updated = [...settings.outreach_event_types, { value, label }];

    try {
      setSaving(true);
      const result = await eventService.updateModuleSettings({
        outreach_event_types: updated,
      });
      setSettings(result);
      setNewTypeValue('');
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

  const handleGenerateForm = async () => {
    try {
      setGeneratingForm(true);
      const result = await eventRequestService.generateForm();
      toast.success('Event request form created! You can find it in the Forms module.');
      toast(
        `Public URL: ${window.location.origin}${result.public_url}`,
        { duration: 8000, icon: '🔗' }
      );
    } catch {
      toast.error('Failed to generate form. It may already exist.');
    } finally {
      setGeneratingForm(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-theme-text-muted" />
        </div>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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

  const visibleTypes = ALL_EVENT_TYPES.filter((t) =>
    settings.visible_event_types.includes(t)
  );
  const hiddenTypes = ALL_EVENT_TYPES.filter(
    (t) => !settings.visible_event_types.includes(t)
  );

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

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-8">
        {/* Event Type Visibility */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <Settings className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Event Type Visibility
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Choose which event types appear as primary filter categories. Hidden types will be
            grouped under the &ldquo;Other&rdquo; tab so members can still use them.
          </p>

          <div className="mb-6">
            <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
              Visible Categories
            </h3>
            <div className="space-y-2">
              {visibleTypes.map((eventType) => (
                <div
                  key={eventType}
                  className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
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
              <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
                Grouped Under &ldquo;Other&rdquo;
              </h3>
              <div className="space-y-2">
                {hiddenTypes.map((eventType) => (
                  <div
                    key={eventType}
                    className="flex items-center justify-between p-3 bg-theme-surface-secondary rounded-lg border border-theme-surface-border"
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
        </section>

        {/* Outreach Event Types */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <FileText className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Outreach Event Types
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure the types of public outreach events your department offers.
            These appear as options on the public event request form.
          </p>

          <div className="space-y-2 mb-4">
            {settings.outreach_event_types.map((ot: OutreachEventTypeConfig) => (
              <div
                key={ot.value}
                className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
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
                Label
              </label>
              <input
                id="new-outreach-label"
                type="text"
                value={newTypeLabel}
                onChange={(e) => {
                  setNewTypeLabel(e.target.value);
                  const auto = e.target.value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                  setNewTypeValue(auto);
                }}
                placeholder="e.g., School Visit"
                className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="w-40">
              <label htmlFor="new-outreach-value" className="block text-xs font-medium text-theme-text-muted mb-1">
                ID (auto)
              </label>
              <input
                id="new-outreach-value"
                type="text"
                value={newTypeValue}
                onChange={(e) => setNewTypeValue(e.target.value.replace(/[^a-z0-9_]/g, ''))}
                placeholder="school_visit"
                className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
              />
            </div>
            <button
              type="button"
              onClick={() => void addOutreachType()}
              disabled={saving || !newTypeLabel.trim() || !newTypeValue.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              Add
            </button>
          </div>
        </section>

        {/* Request Pipeline Configuration */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Request Pipeline
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure how event requests are processed. Define the checklist tasks
            your team works through — each department can order their workflow
            however they like.
          </p>

          {/* Default assignee */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <UserCheck className="w-4 h-4 text-theme-text-muted" />
              <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                Default Coordinator
              </h3>
            </div>
            <p className="text-xs text-theme-text-muted mb-3">
              All new requests will be auto-assigned to this person. They will receive an email notification.
              The coordinator can reassign requests to others.
            </p>
            <select
              value={settings.request_pipeline.default_assignee_id || ''}
              onChange={(e) => void updateDefaultAssignee(e.target.value || null)}
              disabled={saving}
              className="w-full max-w-md px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <Globe className="w-4 h-4 text-theme-text-muted" />
              <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                Public Progress Visibility
              </h3>
            </div>
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => void togglePublicVisibility()}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.request_pipeline.public_progress_visible
                    ? 'bg-green-500'
                    : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span
                  className={`toggle-knob-sm ${
                    settings.request_pipeline.public_progress_visible ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className="text-sm text-theme-text-primary">
                Show pipeline task progress on the public status page
              </span>
            </label>
          </div>

          {/* Lead time */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-4 h-4 text-theme-text-muted" />
              <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider">
                Minimum Lead Time
              </h3>
            </div>
            <p className="text-xs text-theme-text-muted mb-3">
              How far in advance must requests be submitted? This is shown on the public form to set expectations.
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
                className="w-20 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <span className="text-sm text-theme-text-muted">
                days ({Math.floor(settings.request_pipeline.min_lead_time_days / 7)} weeks)
              </span>
            </div>
          </div>

          {/* Pipeline tasks with reorder */}
          <div>
            <h3 className="text-sm font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">
              Pipeline Tasks
            </h3>
            <p className="text-xs text-theme-text-muted mb-3">
              Define the checklist items your team uses when processing requests.
              Tasks can be completed in any order. Use the arrows to set the default display order.
            </p>
            <div className="space-y-2 mb-4">
              {settings.request_pipeline.tasks.map((task: PipelineTaskConfig, idx: number) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
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
                  className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                  className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void addPipelineTask()}
                disabled={saving || !newTaskLabel.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>
          </div>
        </section>

        {/* Email Triggers */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <Mail className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Email Notifications
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Configure which pipeline events trigger email notifications.
            Each department can customize their notification workflow.
          </p>

          <div className="space-y-2">
            {Object.entries(TRIGGER_LABELS).map(([key, label]) => {
              const config = settings.request_pipeline.email_triggers[key] || { enabled: false };
              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
                >
                  <div>
                    <span className="text-sm font-medium text-theme-text-primary">{label}</span>
                    <span className="text-xs text-theme-text-muted ml-2 font-mono">{key}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleEmailTrigger(key)}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      config.enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
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
        </section>

        {/* Email Templates */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-red-700" />
              <h2 className="text-lg font-bold text-theme-text-primary">
                Email Templates
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowTemplateForm(!showTemplateForm)}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              New Template
            </button>
          </div>
          <p className="text-sm text-theme-text-muted mb-6">
            Create reusable email messages that coordinators can send to requesters.
            Use {'{{contact_name}}'}, {'{{outreach_type}}'}, {'{{event_date}}'} as template variables.
          </p>

          {showTemplateForm && (
            <div className="bg-theme-surface-secondary rounded-lg border border-theme-surface-border p-4 mb-4 space-y-3">
              <input
                type="text"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="Template name (e.g., How to Find Our Building)"
                className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <input
                type="text"
                value={newTemplateSubject}
                onChange={(e) => setNewTemplateSubject(e.target.value)}
                placeholder="Email subject"
                className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <textarea
                rows={4}
                value={newTemplateBody}
                onChange={(e) => setNewTemplateBody(e.target.value)}
                placeholder="Email body (HTML supported)"
                className="w-full px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex items-center gap-3">
                <select
                  value={newTemplateTrigger}
                  onChange={(e) => setNewTemplateTrigger(e.target.value)}
                  className="px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  <option value="">Manual send only</option>
                  {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleCreateTemplate()}
                  disabled={saving}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors"
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
                className="flex items-center justify-between p-3 bg-theme-surface rounded-lg border border-theme-surface-border"
              >
                <div>
                  <span className="text-sm font-medium text-theme-text-primary">{tpl.name}</span>
                  <p className="text-xs text-theme-text-muted mt-0.5">
                    Subject: {tpl.subject}
                    {tpl.trigger && (
                      <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
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
        </section>

        {/* Public Event Request Form */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            <ExternalLink className="w-5 h-5 text-red-700" />
            <h2 className="text-lg font-bold text-theme-text-primary">
              Public Event Request Form
            </h2>
          </div>
          <p className="text-sm text-theme-text-muted mb-4">
            Generate a public form that community members can use to request outreach events.
            The form includes flexible date preference fields so requesters express preferences
            rather than committing to exact dates. Your team confirms the date during planning.
          </p>
          <button
            type="button"
            onClick={() => void handleGenerateForm()}
            disabled={generatingForm}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
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
            The form will be created in Draft status. Publish it from the Forms module when ready.
            You can customize fields and styling before publishing.
          </p>
        </section>
      </div>
    </div>
  );
};

export default EventsSettingsTab;
