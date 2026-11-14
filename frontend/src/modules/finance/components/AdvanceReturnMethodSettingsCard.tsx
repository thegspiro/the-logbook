/**
 * How a cash advance's return deadline is worked out
 *
 * The IRS gives two safe harbors for an accountable plan's advances
 * (Treas. Reg. 1.62-2(g)(2)): return what was not spent within 120 days of the
 * check (fixed date, the default), or give the member a statement at least
 * quarterly and allow 120 days from it (periodic statement). The department
 * chooses (owner decision 2026-11-01). An advance takes the method in force
 * when its check is issued and keeps it, so changing this moves no deadline
 * already running. The value shown is the server's reading
 * (`GET /finance/settings`).
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`, like the other finance rules on this page.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { getErrorMessage } from '@/utils/errorHandling';
import { financeSettingsService } from '../services/api';
import { ADVANCE_RETURN_DAYS, AdvanceReturnMethod } from '../types';

const METHOD_LABELS: Record<AdvanceReturnMethod, string> = {
  [AdvanceReturnMethod.FIXED_DATE]: 'Fixed date',
  [AdvanceReturnMethod.PERIODIC_STATEMENT]: 'Quarterly statements',
};

const METHOD_DESCRIPTIONS: Record<AdvanceReturnMethod, string> = {
  [AdvanceReturnMethod.FIXED_DATE]: `Fixed date: a member has ${String(ADVANCE_RETURN_DAYS)} days from the check to account for an advance or return what was not spent.`,
  [AdvanceReturnMethod.PERIODIC_STATEMENT]: `Quarterly statements: at the end of each calendar quarter the member is emailed what is still outstanding, and has ${String(ADVANCE_RETURN_DAYS)} days from the first statement to account for it.`,
};

const isMethod = (value: string): value is AdvanceReturnMethod =>
  (Object.values(AdvanceReturnMethod) as string[]).includes(value);

export const AdvanceReturnMethodSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const [current, setCurrent] = useState<AdvanceReturnMethod | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<AdvanceReturnMethod>(AdvanceReturnMethod.FIXED_DATE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = (await financeSettingsService.get()).advanceReturnMethod ?? AdvanceReturnMethod.FIXED_DATE;
      setCurrent(next);
      setMethod(next);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the cash advance deadline'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await organizationService.updateSettings({ finance: { advance_return_method: method } });
      // Re-read, so the screen shows what the next issued advance will take.
      await load();
      toast.success('Cash advance deadline saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the cash advance deadline'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-6" aria-labelledby="advance-return-method-title">
      <h2 id="advance-return-method-title" className="text-theme-text-primary text-lg font-semibold">
        Cash advance deadline
      </h2>
      {loadError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{loadError}</p>
      ) : current === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">{METHOD_DESCRIPTIONS[current]}</p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        The two IRS methods for an accountable plan. What is not accounted for by the deadline may have to be reported
        as the member&apos;s wages, and they cannot request another advance until it is settled. An advance keeps the
        method in force when its check was issued, so a change applies only to advances issued afterwards.
      </p>

      {canEdit ? (
        current !== null && (
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3" noValidate>
            <fieldset>
              <legend className="form-label">Deadline for returning an advance</legend>
              <div className="flex flex-wrap gap-4">
                {Object.values(AdvanceReturnMethod).map((value) => (
                  <label key={value} className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="advance-return-method"
                      className="form-checkbox rounded-full"
                      value={value}
                      checked={method === value}
                      onChange={(e) => {
                        if (isMethod(e.target.value)) setMethod(e.target.value);
                      }}
                    />
                    {METHOD_LABELS[value]}
                  </label>
                ))}
              </div>
              <p className="text-theme-text-secondary mt-1 text-xs">{METHOD_DESCRIPTIONS[method]}</p>
            </fieldset>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save
            </button>
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

export default AdvanceReturnMethodSettingsCard;
