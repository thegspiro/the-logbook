/**
 * When line owners are reminded about next year's budget-request deadline
 *
 * Owner decision, 2026-11-01: the reminder schedule is the department's to
 * set. The days before a draft year's request deadline (7 and 1 until a
 * department chooses), and whether each reminder also puts an entry in the
 * owner's notification bell. The email still goes out either way — it is
 * the channel of record — and a member can mute it in their own email
 * preferences.
 *
 * The values shown are the server's reading
 * (`GET /finance/settings/budget-request-reminders`), the one the scheduled
 * reminder follows, not a copy of its defaults (pitfall #29). Saving needs
 * `finance.manage`: the schedule is bookkeeping, not a control on the finance
 * officers, so the finance office sets it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { getErrorMessage } from '@/utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { budgetRequestReminderService } from '../services/api';
import type { BudgetRequestReminderSettings } from '../types';
import { MAX_REMINDERS, parseReminderDays } from '../utils/reminderDays';

function describe(settings: BudgetRequestReminderSettings): string {
  if (settings.offsetsDays.length === 0) return 'No reminders are sent before the deadline.';
  const days = settings.offsetsDays.map((d) =>
    d === 0 ? 'on the deadline day' : d === 1 ? '1 day before' : `${d} days before`
  );
  const bell = settings.bellNotices ? ', by email and in the notification bell' : ', by email';
  return `Owners who still owe a request are reminded ${days.join(', ')}${bell}.`;
}

const DAYS_ID = 'budget-request-reminder-days';

/**
 * `BudgetRequestReminderSettingsUpdate` (schemas/finance.py) reports a field
 * by its snake_case name (`loc_by_alias=False`), and a bad entry in the list
 * by its place in it (`offsets_days.2`).
 */
const FIELDS: Record<'offsetsDays', ServerFieldSpec> = {
  offsetsDays: {
    label: 'Days before the request deadline',
    api: ['offsets_days', 'offsetsDays', ...Array.from({ length: MAX_REMINDERS }, (_, i) => `offsets_days.${i}`)],
  },
};

export const BudgetRequestReminderSettingsCard: React.FC = () => {
  const canEdit = useAuthStore((s) => s.checkPermission('finance.manage'));
  const [current, setCurrent] = useState<BudgetRequestReminderSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [daysText, setDaysText] = useState('');
  const [bell, setBell] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // A refusal no field answers for is said inside the card, not only in a
  // toast that fades (forms review F-5).
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await budgetRequestReminderService.get();
      setCurrent(next);
      setDaysText(next.offsetsDays.join(', '));
      setBell(next.bellNotices);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the reminder schedule'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = parseReminderDays(daysText);
    if (typeof parsed === 'string') {
      setFieldError(parsed);
      document.getElementById(DAYS_ID)?.focus();
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      const saved = await budgetRequestReminderService.update({ offsetsDays: parsed, bellNotices: bell });
      setCurrent(saved);
      setDaysText(saved.offsetsDays.join(', '));
      setBell(saved.bellNotices);
      toast.success('Reminder schedule saved');
    } catch (err: unknown) {
      // The schedule is replaced whole (both fields are required), so a
      // refusal saves none of it and the typed days stay to be corrected.
      const mapped = mapServerFieldErrors(err, FIELDS);
      const onField = mapped?.fieldErrors.offsetsDays;
      if (onField) {
        setFieldError(onField);
        document.getElementById(DAYS_ID)?.focus();
      }
      const rest = onField ? (mapped?.unmatched ?? []) : [];
      if (!onField || rest.length > 0) {
        const message = rest.length > 0 ? rest.join(' ') : getErrorMessage(err, 'Could not save the reminder schedule');
        setFormError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-6" aria-labelledby="budget-request-reminders-title">
      <h2 id="budget-request-reminders-title" className="text-theme-text-primary text-lg font-semibold">
        Budget request reminders
      </h2>
      {loadError ? (
        <p role="alert" className={`mt-2 text-sm ${FIELD_ERROR_CLASS}`}>
          {loadError}
        </p>
      ) : current === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">{describe(current)}</p>
      )}

      {canEdit && current !== null && (
        <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3" noValidate>
          <FormField
            id={DAYS_ID}
            label="Days before the request deadline"
            error={fieldError}
            hint={`Separate with commas, up to ${MAX_REMINDERS}; 0 is the deadline day. Leave blank to send none.`}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="form-input max-w-xs"
                value={daysText}
                onChange={(e) => {
                  setDaysText(e.target.value);
                  setFieldError(null);
                }}
              />
            )}
          </FormField>
          <label className="touch:min-h-11 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={bell}
              onChange={(e) => setBell(e.target.checked)}
            />
            <span className="text-theme-text-primary">
              Also put each reminder in the owner&apos;s notification bell
            </span>
          </label>
          <button type="submit" className="btn-primary" disabled={saving}>
            Save
          </button>
          {formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {formError}
            </p>
          )}
        </form>
      )}
    </section>
  );
};

export default BudgetRequestReminderSettingsCard;
