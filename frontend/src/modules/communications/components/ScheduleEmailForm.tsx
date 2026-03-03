/**
 * Schedule Email Form Component
 *
 * Allows admins to schedule an email to be sent at a future date/time.
 */

import React, { useState } from 'react';
import { CalendarClock, Send, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { EmailTemplate, ScheduledEmailCreate } from '../../../services/api';
import { useScheduledEmailsStore } from '../store/scheduledEmailsStore';

interface ScheduleEmailFormProps {
  templates: EmailTemplate[];
  onClose: () => void;
}

const inputClass =
  'w-full rounded-md border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

const ScheduleEmailForm: React.FC<ScheduleEmailFormProps> = ({
  templates,
  onClose,
}) => {
  const { scheduleEmail, isSaving } = useScheduledEmailsStore();

  const [templateType, setTemplateType] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!templateType || !toEmails.trim() || !scheduledDate || !scheduledTime) {
      toast.error('Please fill in all required fields');
      return;
    }

    const recipients = toEmails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const cc = ccEmails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    const bcc = bccEmails
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    const scheduledAt = new Date(
      `${scheduledDate}T${scheduledTime}:00`,
    ).toISOString();

    if (new Date(scheduledAt) <= new Date()) {
      toast.error('Scheduled time must be in the future');
      return;
    }

    const data: ScheduledEmailCreate = {
      template_type: templateType,
      to_emails: recipients,
      cc_emails: cc.length > 0 ? cc : undefined,
      bcc_emails: bcc.length > 0 ? bcc : undefined,
      context: {},
      scheduled_at: scheduledAt,
    };

    try {
      await scheduleEmail(data);
      toast.success('Email scheduled successfully');
      onClose();
    } catch {
      // Error handled by store
    }
  };

  // Get unique template types from existing templates
  const templateTypes = [
    ...new Set(templates.map((t) => t.template_type)),
  ].sort();

  return (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold text-theme-text-primary">
            Schedule Email
          </h3>
        </div>
        <button
          onClick={onClose}
          className="rounded-sm p-1 text-theme-text-secondary hover:bg-theme-surface-hover"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label className={labelClass}>Template Type *</label>
          <select
            value={templateType}
            onChange={(e) => setTemplateType(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">Select a template...</option>
            {templateTypes.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>To (comma-separated emails) *</label>
          <input
            type="text"
            value={toEmails}
            onChange={(e) => setToEmails(e.target.value)}
            className={inputClass}
            placeholder="user@example.com, user2@example.com"
            required
          />
        </div>

        <div>
          <label className={labelClass}>CC (optional, comma-separated)</label>
          <input
            type="text"
            value={ccEmails}
            onChange={(e) => setCcEmails(e.target.value)}
            className={inputClass}
            placeholder="cc@example.com"
          />
        </div>

        <div>
          <label className={labelClass}>BCC (optional, comma-separated)</label>
          <input
            type="text"
            value={bccEmails}
            onChange={(e) => setBccEmails(e.target.value)}
            className={inputClass}
            placeholder="bcc@example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Date *</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className={inputClass}
              min={new Date().toISOString().split('T')[0]}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Time *</label>
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className={inputClass}
              required
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-theme-surface-border px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-hover"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {isSaving ? 'Scheduling...' : 'Schedule Email'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ScheduleEmailForm;
