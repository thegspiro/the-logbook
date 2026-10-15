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
import { Modal } from '../../../components/Modal';
import { organizationService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { minutesService } from '../services/api';
import type { MinutesReminderSettings } from '../types/minutes';

const MAX_DAYS_BEFORE = 30;
const MAX_REPEAT = 90;

interface ReminderSettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const wholeNumber = (draft: string, max: number): number | null => {
  if (draft.trim() === '') return null;
  const value = Number(draft);
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
};

export const ReminderSettingsDialog: React.FC<ReminderSettingsDialogProps> = ({ isOpen, onClose }) => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');

  const [loaded, setLoaded] = useState<MinutesReminderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reminders, setReminders] = useState(true);
  const [daysBefore, setDaysBefore] = useState('3');
  const [repeat, setRepeat] = useState('7');
  const [digest, setDigest] = useState(true);
  const [saving, setSaving] = useState(false);

  const adopt = (next: MinutesReminderSettings) => {
    setLoaded(next);
    setReminders(next.action_item_reminders);
    setDaysBefore(String(next.reminder_days_before_due));
    setRepeat(String(next.overdue_repeat_days));
    setDigest(next.open_items_digest);
  };

  useEffect(() => {
    if (!isOpen) return;
    setLoaded(null);
    setLoadError(null);
    minutesService
      .getReminderSettings()
      .then(adopt)
      .catch((err: unknown) => setLoadError(getErrorMessage(err, 'Failed to load the reminder settings')));
  }, [isOpen]);

  const daysValue = wholeNumber(daysBefore, MAX_DAYS_BEFORE);
  const repeatValue = wholeNumber(repeat, MAX_REPEAT);
  const valid = daysValue !== null && repeatValue !== null;

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
      adopt(await minutesService.getReminderSettings());
      toast.success('Reminder settings saved');
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the reminder settings'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Action item reminders"
      size="md"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button type="submit" disabled={saving || !loaded || !valid} className="btn-primary">
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
        </>
      }
    >
      {loadError && (
        <p className="alert-danger text-sm" role="alert">
          {loadError}
        </p>
      )}
      {!loaded && !loadError && <p className="text-theme-text-muted text-sm">Loading…</p>}
      {loaded && (
        <div className="space-y-4">
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
        </div>
      )}
    </Modal>
  );
};

export default ReminderSettingsDialog;
