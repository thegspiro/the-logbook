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
import { getErrorMessage } from '@/utils/errorHandling';
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

export const SubstantiationSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<SubstantiationMode>(SubstantiationMode.OFF);
  const [days, setDays] = useState('');
  const [daysError, setDaysError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(days);
    if (days.trim() === '' || !Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
      setDaysError(`Enter a whole number of days from 1 to ${MAX_DAYS}.`);
      return;
    }
    setDaysError(null);
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
      toast.error(getErrorMessage(err, 'Could not save the expense deadline'));
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
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{loadError}</p>
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
                      type="radio"
                      name="substantiation-mode"
                      className="form-checkbox rounded-full"
                      value={value}
                      checked={mode === value}
                      onChange={(e) => {
                        if (isMode(e.target.value)) setMode(e.target.value);
                      }}
                    />
                    {MODE_LABELS[value]}
                  </label>
                ))}
              </div>
              <p className="text-theme-text-secondary mt-1 text-xs">{MODE_DESCRIPTIONS[mode]}</p>
            </fieldset>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="substantiation-days" className="form-label">
                  Days allowed
                </label>
                <input
                  id="substantiation-days"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={MAX_DAYS}
                  step="1"
                  className="form-input w-28"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  aria-invalid={Boolean(daysError)}
                  aria-describedby={daysError ? 'substantiation-days-error' : undefined}
                />
              </div>
              <button type="submit" className="btn-primary" disabled={saving}>
                Save
              </button>
            </div>
            {daysError && (
              <p id="substantiation-days-error" className="text-xs text-red-700 dark:text-red-400">
                {daysError}
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
