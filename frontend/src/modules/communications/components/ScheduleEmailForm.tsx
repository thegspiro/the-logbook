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
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import TimeQuarterHour from '../../../components/ux/TimeQuarterHour';
import { FormField } from '../../../components/ux/FormField';
import { validateEmailList, parseEmailList } from '../../../hooks/useEmailListInput';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';

interface ScheduleEmailFormProps {
  templates: EmailTemplate[];
  onClose: () => void;
}

type ScheduleField = 'templateType' | 'toEmails' | 'ccEmails' | 'bccEmails' | 'scheduledDate' | 'scheduledTime';

/** A bad address is reported against its place in the list (`to_emails.2`). */
const listPaths = (name: string) => [name, ...Array.from({ length: 100 }, (_, i) => `${name}.${i}`)];

/** ScheduledEmailCreate in schemas/email_template.py (snake_case); no max_length on these. */
const SCHEDULE_FIELDS: Record<ScheduleField, ServerFieldSpec> = {
  templateType: { label: 'Template type', api: 'template_type' },
  toEmails: { label: 'To', api: listPaths('to_emails') },
  ccEmails: { label: 'CC', api: listPaths('cc_emails') },
  bccEmails: { label: 'BCC', api: listPaths('bcc_emails') },
  scheduledDate: { label: 'Date', api: 'scheduled_at' },
  scheduledTime: { label: 'Time', api: [] },
};

/** In the order they appear, so the first failing one takes focus. */
const SCHEDULE_FIELD_IDS: Record<ScheduleField, string> = {
  templateType: 'schedule-template-type',
  toEmails: 'schedule-to-emails',
  ccEmails: 'schedule-cc-emails',
  bccEmails: 'schedule-bcc-emails',
  scheduledDate: 'schedule-date',
  scheduledTime: 'schedule-time',
};

const ScheduleEmailForm: React.FC<ScheduleEmailFormProps> = ({ templates, onClose }) => {
  const { scheduleEmail, isSaving, error: storeError, clearError: clearStoreError } = useScheduledEmailsStore();
  const tz = useTimezone();

  const [templateType, setTemplateType] = useState('');
  const [toEmails, setToEmails] = useState('');
  const [ccEmails, setCcEmails] = useState('');
  const [bccEmails, setBccEmails] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const todayLocal = getTodayLocalDate(tz);

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ScheduleField, string>>>({});
  const clearFieldError = (field: ScheduleField) => setFieldErrors((prev) => ({ ...prev, [field]: undefined }));

  // An inline panel rather than a dialog, but Cancel and the X still throw the
  // typed recipients away, so they ask first when there is anything to lose.
  const requestClose = useDiscardGuard({
    isDirty: [templateType, toEmails, ccEmails, bccEmails, scheduledDate, scheduledTime].some((v) => v.trim() !== ''),
    onClose,
  });

  const showErrors = (next: Partial<Record<ScheduleField, string>>) => {
    setFieldErrors(next);
    const first = (Object.keys(SCHEDULE_FIELD_IDS) as ScheduleField[]).find((field) => next[field]);
    if (first) window.setTimeout(() => document.getElementById(SCHEDULE_FIELD_IDS[first])?.focus(), 0);
  };

  // A new scheduled email: nothing is scheduled until every refusal is fixed.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: Partial<Record<ScheduleField, string>> = {};
    if (!templateType) errors.templateType = 'Choose a template.';
    if (!toEmails.trim()) errors.toEmails = 'At least one recipient is required.';
    if (!scheduledDate) errors.scheduledDate = 'Choose a date.';
    if (!scheduledTime) errors.scheduledTime = 'Choose a time.';

    const toError = validateEmailList(toEmails);
    if (toError) errors.toEmails = toError;
    const ccError = validateEmailList(ccEmails);
    if (ccError) errors.ccEmails = ccError;
    const bccError = validateEmailList(bccEmails);
    if (bccError) errors.bccEmails = bccError;

    // Compared in UTC, so the organization's timezone decides what "now" is.
    if (scheduledDate && scheduledTime) {
      const selectedUTC = new Date(localToUTC(`${scheduledDate}T${scheduledTime}`, tz));
      if (selectedUTC <= new Date()) errors.scheduledDate = 'Choose a date and time in the future.';
    }

    if (Object.keys(errors).length > 0) {
      showErrors(errors);
      return;
    }
    setFieldErrors({});

    const recipients = parseEmailList(toEmails);
    const cc = parseEmailList(ccEmails);
    const bcc = parseEmailList(bccEmails);

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
      toast.success('Email scheduled');
      onClose();
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, SCHEDULE_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) {
        // Said on the field instead of in the store's banner, which would name the API key.
        if (mapped.unmatched.length === 0) clearStoreError();
        showErrors(mapped.fieldErrors);
        return;
      }
      toast.error('Unable to schedule the email. Try again.');
    }
  };

  // Get unique template types from existing templates.
  //
  // Storefront notices are excluded: each is raised by the store against a
  // specific order or window and reads entirely from it — order number, item
  // table, balance. Scheduled, there is no order to read, and the email would
  // go out announcing "Order  received" with an empty table. They are edited
  // in Email Templates and sent by the store, never scheduled by hand.
  const templateTypes = [
    ...new Set(templates.map((t) => t.template_type).filter((type) => !type.startsWith('storefront_'))),
  ].sort();

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-blue-500" aria-hidden="true" />
          <h3 className="text-theme-text-primary text-lg font-semibold">Schedule Email</h3>
        </div>
        <button
          type="button"
          onClick={requestClose}
          className="text-theme-text-secondary hover:bg-theme-surface-hover rounded-sm p-1"
          aria-label="Close schedule form"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {storeError && (
        <div role="alert" className="alert-danger text-theme-text-primary mb-4 text-sm">
          {storeError}
        </div>
      )}

      <form noValidate onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
        <FormField label="Template Type" required id={SCHEDULE_FIELD_IDS.templateType} error={fieldErrors.templateType}>
          {(field) => (
            <select
              {...field}
              value={templateType}
              onChange={(e) => {
                setTemplateType(e.target.value);
                clearFieldError('templateType');
              }}
              className="form-input"
            >
              <option value="">Select a template...</option>
              {templateTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label="To (comma-separated emails)"
          required
          id={SCHEDULE_FIELD_IDS.toEmails}
          error={fieldErrors.toEmails}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={toEmails}
              onChange={(e) => {
                setToEmails(e.target.value);
                clearFieldError('toEmails');
              }}
              className="form-input"
              placeholder="user@example.com, user2@example.com"
            />
          )}
        </FormField>

        <FormField label="CC (comma-separated)" optional id={SCHEDULE_FIELD_IDS.ccEmails} error={fieldErrors.ccEmails}>
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={ccEmails}
              onChange={(e) => {
                setCcEmails(e.target.value);
                clearFieldError('ccEmails');
              }}
              className="form-input"
              placeholder="cc@example.com"
            />
          )}
        </FormField>

        <FormField
          label="BCC (comma-separated)"
          optional
          id={SCHEDULE_FIELD_IDS.bccEmails}
          error={fieldErrors.bccEmails}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={bccEmails}
              onChange={(e) => {
                setBccEmails(e.target.value);
                clearFieldError('bccEmails');
              }}
              className="form-input"
              placeholder="bcc@example.com"
            />
          )}
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField label="Date" required id={SCHEDULE_FIELD_IDS.scheduledDate} error={fieldErrors.scheduledDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  setScheduledDate(e.target.value);
                  clearFieldError('scheduledDate');
                }}
                className="form-input"
                min={todayLocal}
              />
            )}
          </FormField>
          <FormField label="Time" required id={SCHEDULE_FIELD_IDS.scheduledTime} error={fieldErrors.scheduledTime}>
            {(field) => (
              <TimeQuarterHour
                {...field}
                aria-label="Time"
                value={scheduledTime}
                onChange={(e) => {
                  setScheduledTime(e.target.value);
                  clearFieldError('scheduledTime');
                  clearFieldError('scheduledDate');
                }}
                className="form-input"
              />
            )}
          </FormField>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={requestClose}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving}
            className="flex items-center gap-2 rounded-md bg-red-800 px-4 py-2 text-sm text-white hover:bg-red-900 disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {isSaving ? 'Scheduling...' : 'Schedule Email'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ScheduleEmailForm;
