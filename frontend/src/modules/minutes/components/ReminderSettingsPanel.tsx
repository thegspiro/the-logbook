/**
 * How the department wants action items from adopted minutes followed up.
 *
 * The values shown are what the server will apply (`GET /minutes-records/
 * settings`), never a local default, so the screen cannot promise a reminder
 * the daily task does not send. Anyone who manages minutes can read them;
 * writing goes through the organization settings and needs `settings.manage`.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FormField } from '../../../components/ux/FormField';
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import type { MinutesSettingsPanelProps } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

/** MinutesSettingsUpdate in schemas/organization.py: ge=0, le=30 and le=90. */
const MAX_DAYS_BEFORE = 30;
const MAX_REPEAT = 90;

type ReminderField = 'action_item_reminders' | 'reminder_days_before_due' | 'overdue_repeat_days' | 'open_items_digest';

const REMINDER_FIELDS: Record<ReminderField, ServerFieldSpec> = {
  action_item_reminders: { label: 'Email reminders', api: 'minutes.action_item_reminders' },
  reminder_days_before_due: { label: 'First reminder', api: 'minutes.reminder_days_before_due' },
  overdue_repeat_days: { label: 'Repeat while overdue', api: 'minutes.overdue_repeat_days' },
  open_items_digest: { label: 'Weekly list', api: 'minutes.open_items_digest' },
};

const REMINDER_FIELD_IDS: Partial<Record<ReminderField, string>> = {
  reminder_days_before_due: 'reminder-days-before',
  overdue_repeat_days: 'reminder-repeat',
};

const wholeNumber = (draft: string, max: number): number | null => {
  if (draft.trim() === '') return null;
  const value = Number(draft);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
};

export const ReminderSettingsPanel: React.FC<MinutesSettingsPanelProps> = ({ settings, canEdit, onSaved }) => {
  const [reminders, setReminders] = useState(settings.action_item_reminders);
  const [daysBefore, setDaysBefore] = useState(String(settings.reminder_days_before_due));
  const [repeat, setRepeat] = useState(String(settings.overdue_repeat_days));
  const [digest, setDigest] = useState(settings.open_items_digest);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ReminderField, string | undefined>>>({});
  const [savedExcept, setSavedExcept] = useState(false);

  useEffect(() => {
    setReminders(settings.action_item_reminders);
    setDaysBefore(String(settings.reminder_days_before_due));
    setRepeat(String(settings.overdue_repeat_days));
    setDigest(settings.open_items_digest);
  }, [
    settings.action_item_reminders,
    settings.reminder_days_before_due,
    settings.overdue_repeat_days,
    settings.open_items_digest,
  ]);

  const daysValue = wholeNumber(daysBefore, MAX_DAYS_BEFORE);
  const repeatValue = wholeNumber(repeat, MAX_REPEAT);
  const dirty =
    reminders !== settings.action_item_reminders ||
    daysBefore !== String(settings.reminder_days_before_due) ||
    repeat !== String(settings.overdue_repeat_days) ||
    digest !== settings.open_items_digest;

  const showErrors = (next: Partial<Record<ReminderField, string>>) => {
    setErrors(next);
    const first = (Object.keys(REMINDER_FIELD_IDS) as ReminderField[]).find((field) => next[field]);
    const id = first ? REMINDER_FIELD_IDS[first] : undefined;
    if (id) window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  };

  /**
   * A single save (owner rule of 2026-11-05): a number out of range is left
   * out, so the server keeps the value it applies now, the rest is saved, and
   * the field stays flagged.
   */
  const save = async () => {
    let refused: Partial<Record<ReminderField, string>> = {};
    if (daysValue === null) refused.reminder_days_before_due = 'Not saved: this needs a number in the range below.';
    if (repeatValue === null) refused.overdue_repeat_days = 'Not saved: this needs a number in the range below.';
    // Every field the form owns is sent, so each save states the whole
    // choice rather than leaving part of it to an earlier one.
    const minutes: Record<ReminderField, unknown> = {
      action_item_reminders: reminders,
      reminder_days_before_due: daysValue,
      overdue_repeat_days: repeatValue,
      open_items_digest: digest,
    };
    const without = () => {
      const rest: Partial<Record<ReminderField, unknown>> = { ...minutes };
      for (const field of Object.keys(refused) as ReminderField[]) delete rest[field];
      return rest;
    };
    setSaving(true);
    setSavedExcept(false);
    setErrors({});
    try {
      try {
        await organizationService.updateSettings({ minutes: without() });
      } catch (err: unknown) {
        const mapped = mapServerFieldErrors(err, REMINDER_FIELDS);
        if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
        refused = { ...refused, ...mapped.fieldErrors };
        await organizationService.updateSettings({ minutes: without() });
      }
      // Re-read rather than trusting what was sent, so the screen shows what
      // the daily task will do.
      await onSaved();
      if (Object.keys(refused).length > 0) {
        showErrors(refused);
        setSavedExcept(true);
        return;
      }
      toast.success('Reminder settings saved');
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, REMINDER_FIELDS);
      if (mapped && Object.keys(mapped.fieldErrors).length > 0) showErrors({ ...refused, ...mapped.fieldErrors });
      toast.error(getErrorMessage(err, 'Failed to save the reminder settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-theme-text-secondary text-sm">
        Once minutes are adopted, the member each action item is assigned to is emailed as it comes due. Items on
        minutes that are still drafts are never chased.
        {!canEdit && ' These settings are changed by a settings administrator.'}
      </p>
      {savedExcept && (
        <p role="status" className="alert-warning text-theme-text-primary text-sm">
          Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
        </p>
      )}

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="form-checkbox mt-0.5"
          checked={reminders}
          disabled={!canEdit || saving}
          onChange={(e) => setReminders(e.target.checked)}
        />
        <span>
          <span className="text-theme-text-primary block text-sm font-medium">Email reminders to assignees</span>
          <span className="text-theme-text-secondary block text-xs">
            Members can still turn these emails off for themselves in their own preferences.
          </span>
        </span>
      </label>

      <FormField
        label="First reminder, days before the due date"
        id="reminder-days-before"
        error={errors.reminder_days_before_due}
        hint={
          daysValue === null
            ? `Enter a whole number from 0 to ${MAX_DAYS_BEFORE}.`
            : daysValue === 0
              ? 'On the day it is due, and not before.'
              : `${daysValue} day${daysValue === 1 ? '' : 's'} ahead.`
        }
      >
        {(field) => (
          <input
            {...field}
            type="number"
            min={0}
            max={MAX_DAYS_BEFORE}
            step={1}
            inputMode="numeric"
            className="form-input w-28"
            value={daysBefore}
            disabled={!canEdit || saving || !reminders}
            onChange={(e) => {
              setDaysBefore(e.target.value);
              setErrors((prev) => ({ ...prev, reminder_days_before_due: undefined }));
            }}
          />
        )}
      </FormField>

      <FormField
        label="Repeat while overdue, every this many days"
        id="reminder-repeat"
        error={errors.overdue_repeat_days}
        hint={
          repeatValue === null
            ? `Enter a whole number from 0 to ${MAX_REPEAT}.`
            : repeatValue === 0
              ? 'One overdue reminder, the day after it falls due, and no more.'
              : `The first the day after it falls due, then every ${repeatValue} day${repeatValue === 1 ? '' : 's'} until it is completed or cancelled.`
        }
      >
        {(field) => (
          <input
            {...field}
            type="number"
            min={0}
            max={MAX_REPEAT}
            step={1}
            inputMode="numeric"
            className="form-input w-28"
            value={repeat}
            disabled={!canEdit || saving || !reminders}
            onChange={(e) => {
              setRepeat(e.target.value);
              setErrors((prev) => ({ ...prev, overdue_repeat_days: undefined }));
            }}
          />
        )}
      </FormField>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="form-checkbox mt-0.5"
          checked={digest}
          disabled={!canEdit || saving}
          onChange={(e) => setDigest(e.target.checked)}
        />
        <span>
          <span className="text-theme-text-primary block text-sm font-medium">
            Weekly list of open items to minutes managers
          </span>
          <span className="text-theme-text-secondary block text-xs">
            Everyone who manages minutes gets every open item and who owns it, including items with no due date.
          </span>
        </span>
      </label>

      <SettingsSaveBar canEdit={canEdit} dirty={dirty} saving={saving} />
    </form>
  );
};

export default ReminderSettingsPanel;
