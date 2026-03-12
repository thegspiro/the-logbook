import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EmailSectionProps } from './types';

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

const EmailSection: React.FC<EmailSectionProps> = ({
  settings,
  saving,
  emailTemplates,
  showTemplateForm,
  onToggleTemplateForm,
  onToggleEmailTrigger,
  onCreateTemplate,
  onDeleteTemplate,
  newTemplateName,
  onNewTemplateNameChange,
  newTemplateSubject,
  onNewTemplateSubjectChange,
  newTemplateBody,
  onNewTemplateBodyChange,
  newTemplateTrigger,
  onNewTemplateTriggerChange,
}) => {
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
                  onClick={() => onToggleEmailTrigger(key)}
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
            onClick={() => onToggleTemplateForm(!showTemplateForm)}
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
              onChange={(e) => onNewTemplateNameChange(e.target.value)}
              placeholder="Template name (e.g., How to Find Our Building)"
              className="form-input placeholder-theme-text-muted text-sm"
            />
            <input
              type="text"
              value={newTemplateSubject}
              onChange={(e) => onNewTemplateSubjectChange(e.target.value)}
              placeholder="Email subject"
              className="form-input placeholder-theme-text-muted text-sm"
            />
            <textarea
              rows={4}
              value={newTemplateBody}
              onChange={(e) => onNewTemplateBodyChange(e.target.value)}
              placeholder="Email body (HTML supported)"
              className="form-input placeholder-theme-text-muted text-sm"
            />
            <div className="flex items-center gap-3">
              <select
                value={newTemplateTrigger}
                onChange={(e) => onNewTemplateTriggerChange(e.target.value)}
                className="w-full rounded-md bg-theme-input-bg border border-theme-input-border text-theme-text-primary px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-theme-focus-ring"
              >
                <option value="">Manual send only</option>
                {Object.entries(TRIGGER_LABELS).map(([key, triggerLabel]) => (
                  <option key={key} value={key}>{triggerLabel}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={onCreateTemplate}
                disabled={saving}
                className="btn-primary font-medium text-sm"
              >
                Save Template
              </button>
              <button
                type="button"
                onClick={() => onToggleTemplateForm(false)}
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
                onClick={() => onDeleteTemplate(tpl.id)}
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
};

export default EmailSection;
