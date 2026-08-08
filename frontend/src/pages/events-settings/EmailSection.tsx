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
        <h3 className="text-theme-text-primary text-lg font-semibold">Email Configuration</h3>
        <p className="text-theme-text-muted mt-1 text-sm">Notification triggers and reusable email templates.</p>
      </div>

      {/* Email Triggers */}
      <div>
        <h4 className="text-theme-text-muted mb-2 text-xs font-semibold tracking-wider uppercase">
          Notification Triggers
        </h4>
        <div className="space-y-2">
          {Object.entries(TRIGGER_LABELS).map(([key, label]) => {
            const config = settings.request_pipeline.email_triggers[key] || { enabled: false };
            return (
              <div
                key={key}
                className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
              >
                <span className="text-theme-text-primary text-sm font-medium">{label}</span>
                <button
                  type="button"
                  onClick={() => onToggleEmailTrigger(key)}
                  disabled={saving}
                  className={`focus:ring-theme-focus-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 ${
                    config.enabled ? 'bg-green-500' : 'bg-theme-surface-hover'
                  }`}
                  role="switch"
                  aria-checked={config.enabled}
                  aria-label={label}
                >
                  <span className={`toggle-knob-sm ${config.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Email Templates */}
      <div className="border-theme-surface-border border-t pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">Email Templates</h4>
          <button
            type="button"
            onClick={() => onToggleTemplateForm(!showTemplateForm)}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            New Template
          </button>
        </div>
        <p className="text-theme-text-muted mb-3 text-xs">
          Reusable email messages for coordinators. Variables: {'{{contact_name}}'}, {'{{outreach_type}}'},{' '}
          {'{{event_date}}'}.
        </p>

        {showTemplateForm && (
          <div className="border-theme-surface-border bg-theme-surface-secondary/30 mb-4 space-y-3 rounded-lg border p-4">
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
                className="bg-theme-input-bg border-theme-input-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
              >
                <option value="">Manual send only</option>
                {Object.entries(TRIGGER_LABELS).map(([key, triggerLabel]) => (
                  <option key={key} value={key}>
                    {triggerLabel}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onCreateTemplate}
                disabled={saving}
                className="btn-primary text-sm font-medium"
              >
                Save Template
              </button>
              <button
                type="button"
                onClick={() => onToggleTemplateForm(false)}
                className="text-theme-text-muted hover:text-theme-text-primary px-4 py-2 text-sm font-medium transition-colors"
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
              className="border-theme-surface-border flex items-center justify-between rounded-lg border p-3"
            >
              <div>
                <span className="text-theme-text-primary text-sm font-medium">{tpl.name}</span>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  Subject: {tpl.subject}
                  {tpl.trigger && (
                    <span className="ml-2 inline-flex items-center rounded-sm bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-500/20 dark:text-blue-400">
                      Auto: {TRIGGER_LABELS[tpl.trigger] || tpl.trigger}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDeleteTemplate(tpl.id)}
                className="text-theme-text-muted text-sm transition-colors hover:text-red-600 dark:hover:text-red-400"
                title="Delete template"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {emailTemplates.length === 0 && !showTemplateForm && (
            <p className="text-theme-text-muted py-4 text-center text-sm italic">
              No email templates yet. Create one to send standardized messages to requesters.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default EmailSection;
