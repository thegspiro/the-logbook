/**
 * The accountable-plan deadline for expense reports
 *
 * A reimbursement is paid tax-free under an accountable plan only if the
 * expense is claimed within a reasonable time; the IRS safe harbor is 60 days.
 * The department chooses what a late line does: nothing (off), an approver must
 * confirm it (warn), or the report cannot be submitted (block). The values shown
 * are the server's reading (`GET /finance/settings`), never a local default.
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`, like the dual-approval threshold beside it: the rule binds
 * the finance officers who approve reimbursements.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { getErrorMessage } from '@/utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { financeSettingsService } from '../services/api';
import { SubstantiationMode, type FinanceSettings } from '../types';

/** The IRS safe harbor; the server refuses more. */
const MAX_DAYS = 60;

const MODE_LABELS: Record<SubstantiationMode, string> = {
  [SubstantiationMode.OFF]: 'Off',
  [SubstantiationMode.WARN]: 'Warn',
  [SubstantiationMode.BLOCK]: 'Block',
};

const MODE_DESCRIPTIONS: Record<SubstantiationMode, string> = {
  [SubstantiationMode.OFF]: 'Off: expenses are accepted however old they are.',
  [SubstantiationMode.WARN]:
    'Warn: a report with a late expense goes through, and an approver must confirm the late lines before approving it.',
  [SubstantiationMode.BLOCK]: 'Block: a report with a late expense cannot be submitted.',
};

const isMode = (value: string): value is SubstantiationMode =>
  (Object.values(SubstantiationMode) as string[]).includes(value);

type SubstantiationField = 'mode' | 'days';

/** `FinanceSettingsUpdate` (schemas/organization.py), refused by its path under `finance`. */
const FIELDS: Record<SubstantiationField, ServerFieldSpec> = {
  mode: { label: 'When an expense is late', api: 'finance.substantiation_mode' },
  days: { label: 'Days allowed', api: 'finance.substantiation_days' },
};
const DAYS_ID = 'substantiation-days';
const MODE_ERROR_ID = 'substantiation-mode-error';

export const SubstantiationSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<SubstantiationMode>(SubstantiationMode.OFF);
  const [days, setDays] = useState('');
  const [errors, setErrors] = useState<Partial<Record<SubstantiationField, string | undefined>>>({});
  const [saving, setSaving] = useState(false);
  // A refusal no field answers for is said inside the card, not only in a
  // toast that fades (forms review F-5).
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await financeSettingsService.get();
      setSettings(next);
      setMode(next.substantiationMode);
      setDays(String(next.substantiationDays));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the expense deadline'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const focusFirst = (next: Partial<Record<SubstantiationField, string>>) => {
    const id = next.mode ? `substantiation-mode-${mode}` : next.days ? DAYS_ID : undefined;
    if (id) window.setTimeout(() => document.getElementById(id)?.focus(), 0);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const value = Number(days);
    if (days.trim() === '' || !Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
      const next = { days: `Enter a whole number of days from 1 to ${MAX_DAYS}.` };
      setErrors(next);
      focusFirst(next);
      return;
    }
    // The mode and the days are one rule: a late line is judged by both, so a
    // refused day count sends neither rather than switching the mode on over
    // a window nobody chose. This rule binds reimbursement approvals, and this
    // form changes only how a refusal is shown, not what is sent.
    setErrors({});
    setSaving(true);
    try {
      await organizationService.updateSettings({
        finance: { substantiation_mode: mode, substantiation_days: value },
      });
      // Re-read rather than trusting the values sent, so the screen shows what
      // submission will actually enforce.
      await load();
      toast.success('Expense deadline saved');
    } catch (err: unknown) {
      const mapped = mapServerFieldErrors(err, FIELDS);
      const placed = mapped && Object.keys(mapped.fieldErrors).length > 0 ? mapped : null;
      if (placed) {
        setErrors(placed.fieldErrors);
        focusFirst(placed.fieldErrors);
      }
      const rest = placed ? placed.unmatched : [];
      if (!placed || rest.length > 0) {
        const message = rest.length > 0 ? rest.join(' ') : getErrorMessage(err, 'Could not save the expense deadline');
        setFormError(message);
        toast.error(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-6" aria-labelledby="substantiation-title">
      <h2 id="substantiation-title" className="text-theme-text-primary text-lg font-semibold">
        Deadline for claiming expenses
      </h2>
      {loadError ? (
        <p role="alert" className={`mt-2 text-sm ${FIELD_ERROR_CLASS}`}>
          {loadError}
        </p>
      ) : settings === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">
          {settings.substantiationMode === SubstantiationMode.OFF
            ? 'Off: expenses are accepted however old they are.'
            : `${MODE_LABELS[settings.substantiationMode]}: expenses must be claimed within ${settings.substantiationDays} days.`}
        </p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        Reimbursements are tax-free under an accountable plan only when expenses are claimed within a reasonable time.
        The IRS treats 60 days as reasonable, so the deadline can be shorter but not longer. Late expenses show on{' '}
        <span className="font-medium">Finance › Reports › Outside the accountable plan</span>.
      </p>

      {canEdit ? (
        settings !== null && (
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3" noValidate>
            <fieldset>
              <legend className="form-label">When an expense is late</legend>
              <div className="flex flex-wrap gap-4">
                {Object.values(SubstantiationMode).map((value) => (
                  <label key={value} className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      id={`substantiation-mode-${value}`}
                      type="radio"
                      name="substantiation-mode"
                      className="form-checkbox rounded-full"
                      value={value}
                      checked={mode === value}
                      aria-invalid={errors.mode ? true : undefined}
                      aria-describedby={errors.mode ? MODE_ERROR_ID : undefined}
                      onChange={(e) => {
                        if (isMode(e.target.value)) setMode(e.target.value);
                        setErrors((prev) => ({ ...prev, mode: undefined }));
                      }}
                    />
                    {MODE_LABELS[value]}
                  </label>
                ))}
              </div>
              <p className="text-theme-text-secondary mt-1 text-xs">{MODE_DESCRIPTIONS[mode]}</p>
              {errors.mode && (
                <p id={MODE_ERROR_ID} className={`mt-1 text-sm ${FIELD_ERROR_CLASS}`}>
                  {errors.mode}
                </p>
              )}
            </fieldset>
            <FormField id={DAYS_ID} label="Days allowed" error={errors.days}>
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={MAX_DAYS}
                  step="1"
                  className="form-input w-28"
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    setErrors((prev) => ({ ...prev, days: undefined }));
                  }}
                />
              )}
            </FormField>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save
            </button>
            {formError && (
              <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
                {formError}
              </p>
            )}
          </form>
        )
      ) : (
        <p className="text-theme-text-secondary mt-3 text-sm">
          Only a settings administrator can change this, because it applies to the finance officers themselves.
        </p>
      )}
    </section>
  );
};

export default SubstantiationSettingsCard;
