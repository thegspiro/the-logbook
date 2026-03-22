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
import { localToUTC, getTodayLocalDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import TimeQuarterHour from '../../../components/ux/TimeQuarterHour';

interface ScheduleEmailFormProps {
  templates: EmailTemplate[];
  onClose: () => void;
}

const inputClass = 'form-input';
const labelClass = 'form-label';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmailList(raw: string): string | null {
  if (!raw.trim()) return null;
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  const invalid = entries.filter((e) => !EMAIL_REGEX.test(e));
  if (invalid.length > 0) {
    return `Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`;
  }
  return null;
}

const ScheduleEmailForm: React.FC<ScheduleEmailFormProps> = ({
  templates,
  onClose,
}) => {
  const { scheduleEmail, isSaving, error: storeError } = useScheduledEmailsStore();
  const tz = useTimezone();

  const [templateType, setTemplateType] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const todayLocal = getTodayLocalDate(tz);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Record<string, string> = {};
    if (!templateType) errors.templateType = 'Please select a template';
    if (!toEmails.trim()) errors.toEmails = 'At least one recipient is required';
    if (!scheduledDate) errors.scheduledDate = 'Date is required';
    if (!scheduledTime) errors.scheduledTime = 'Time is required';

    const toError = validateEmailList(toEmails);
    if (toError) errors.toEmails = toError;
    const ccError = validateEmailList(ccEmails);
    if (ccError) errors.ccEmails = ccError;
    const bccError = validateEmailList(bccEmails);
    if (bccError) errors.bccEmails = bccError;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const first = Object.values(errors)[0] ?? 'Please fix the errors below';
      toast.error(first);
      return;
    }
    setFieldErrors({});

    // Validate scheduled time is in the future (compare in UTC)
    const selectedUTC = new Date(localToUTC(`${scheduledDate}T${scheduledTime}`, tz));
    if (selectedUTC <= new Date()) {
      toast.error('Scheduled time must be in the future');
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

    const scheduledAt = localToUTC(`${scheduledDate}T${scheduledTime}`, tz);

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
      toast.error('Failed to schedule email. Please try again.');
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
          aria-label="Close schedule form"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {storeError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {storeError}
        </div>
      )}

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <div>
          <label htmlFor="schedule-template-type" className={labelClass}>Template Type *</label>
          <select
            id="schedule-template-type"
            value={templateType}
            onChange={(e) => { setTemplateType(e.target.value); setFieldErrors((p) => { const { templateType: _, ...rest } = p; return rest; }); }}
            className={`${inputClass} ${fieldErrors.templateType ? 'border-red-500' : ''}`}
            required
            aria-invalid={!!fieldErrors.templateType}
          >
            <option value="">Select a template...</option>
            {templateTypes.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
              </option>
            ))}
          </select>
          {fieldErrors.templateType && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.templateType}</p>
          )}
        </div>

        <div>
          <label htmlFor="schedule-to-emails" className={labelClass}>To (comma-separated emails) *</label>
          <input
            id="schedule-to-emails"
            type="text"
            value={toEmails}
            onChange={(e) => { setToEmails(e.target.value); setFieldErrors((p) => { const { toEmails: _, ...rest } = p; return rest; }); }}
            className={`${inputClass} ${fieldErrors.toEmails ? 'border-red-500' : ''}`}
            placeholder="user@example.com, user2@example.com"
            required
            aria-invalid={!!fieldErrors.toEmails}
          />
          {fieldErrors.toEmails && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.toEmails}</p>
          )}
        </div>

        <div>
          <label htmlFor="schedule-cc-emails" className={labelClass}>CC (optional, comma-separated)</label>
          <input
            id="schedule-cc-emails"
            type="text"
            value={ccEmails}
            onChange={(e) => { setCcEmails(e.target.value); setFieldErrors((p) => { const { ccEmails: _, ...rest } = p; return rest; }); }}
            className={`${inputClass} ${fieldErrors.ccEmails ? 'border-red-500' : ''}`}
            placeholder="cc@example.com"
            aria-invalid={!!fieldErrors.ccEmails}
          />
          {fieldErrors.ccEmails && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.ccEmails}</p>
          )}
        </div>

        <div>
          <label htmlFor="schedule-bcc-emails" className={labelClass}>BCC (optional, comma-separated)</label>
          <input
            id="schedule-bcc-emails"
            type="text"
            value={bccEmails}
            onChange={(e) => { setBccEmails(e.target.value); setFieldErrors((p) => { const { bccEmails: _, ...rest } = p; return rest; }); }}
            className={`${inputClass} ${fieldErrors.bccEmails ? 'border-red-500' : ''}`}
            placeholder="bcc@example.com"
            aria-invalid={!!fieldErrors.bccEmails}
          />
          {fieldErrors.bccEmails && (
            <p className="mt-1 text-xs text-red-500">{fieldErrors.bccEmails}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Date *</label>
            <input
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className={inputClass}
              min={todayLocal}
              required
            />
          </div>
          <div>
            <label className={labelClass}>Time *</label>
            <TimeQuarterHour
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
