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
import { organizationService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { MinutesSettingsPanelProps } from '../types/minutes';
import { SettingsSaveBar } from './SettingsSaveBar';

const MAX_DAYS_BEFORE = 30;
const MAX_REPEAT = 90;

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
  const valid = daysValue !== null && repeatValue !== null;
  const dirty =
    reminders !== settings.action_item_reminders ||
    daysBefore !== String(settings.reminder_days_before_due) ||
    repeat !== String(settings.overdue_repeat_days) ||
    digest !== settings.open_items_digest;

  const save = async () => {
    if (daysValue === null || repeatValue === null) return;
    setSaving(true);
    try {
      // Every field the form owns is sent, so each save states the whole
      // choice rather than leaving part of it to an earlier one.
      await organizationService.updateSettings({
        minutes: {
          action_item_reminders: reminders,
          reminder_days_before_due: daysValue,
          overdue_repeat_days: repeatValue,
          open_items_digest: digest,
        },
      });
      // Re-read rather than trusting what was sent, so the screen shows what
      // the daily task will do.
      await onSaved();
      toast.success('Reminder settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the reminder settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-4"
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

      <div>
        <label htmlFor="reminder-days-before" className="form-label">
          First reminder, days before the due date
        </label>
        <input
          id="reminder-days-before"
          type="number"
          min={0}
          max={MAX_DAYS_BEFORE}
          step={1}
          inputMode="numeric"
          className="form-input w-28"
          value={daysBefore}
          disabled={!canEdit || saving || !reminders}
          onChange={(e) => setDaysBefore(e.target.value)}
        />
        <p className="text-theme-text-muted mt-1 text-xs">
          {daysValue === null
            ? `Enter a whole number from 0 to ${MAX_DAYS_BEFORE}.`
            : daysValue === 0
              ? 'On the day it is due, and not before.'
              : `${daysValue} day${daysValue === 1 ? '' : 's'} ahead.`}
        </p>
      </div>

      <div>
        <label htmlFor="reminder-repeat" className="form-label">
          Repeat while overdue, every this many days
        </label>
        <input
          id="reminder-repeat"
          type="number"
          min={0}
          max={MAX_REPEAT}
          step={1}
          inputMode="numeric"
          className="form-input w-28"
          value={repeat}
          disabled={!canEdit || saving || !reminders}
          onChange={(e) => setRepeat(e.target.value)}
        />
        <p className="text-theme-text-muted mt-1 text-xs">
          {repeatValue === null
            ? `Enter a whole number from 0 to ${MAX_REPEAT}.`
            : repeatValue === 0
              ? 'One overdue reminder, the day after it falls due, and no more.'
              : `The first the day after it falls due, then every ${repeatValue} day${repeatValue === 1 ? '' : 's'} until it is completed or cancelled.`}
        </p>
      </div>

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

      <SettingsSaveBar canEdit={canEdit} dirty={dirty} saving={saving} valid={valid} />
    </form>
  );
};

export default ReminderSettingsPanel;
