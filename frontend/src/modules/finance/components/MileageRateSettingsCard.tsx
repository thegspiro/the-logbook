/**
 * The department's mileage rate
 *
 * A mileage expense line can record its trips instead of uploading a log
 * (owner decision 2026-11-01); the server prices it at this rate. There is no
 * built-in figure -- the IRS business rate changes every year and a department
 * may pay less -- so until one is set, members claim mileage with an amount
 * and an uploaded log as before. The value shown is the server's reading
 * (`GET /finance/settings`).
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`, like the expense deadline beside it: it decides what the
 * department pays its members.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { financeSettingsService } from '../services/api';

/** The server's bounds: up to three decimal places, 0.001 to 5 dollars a mile. */
const RATE_PATTERN = /^\d(\.\d{1,3})?$/;
const MAX_RATE = 5;

export const MileageRateSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const [rate, setRate] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await financeSettingsService.get();
      setRate(next.mileageRate ?? null);
      setValue(next.mileageRate ?? '');
      setLoaded(true);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the mileage rate'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next: string | null) => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ finance: { mileage_rate: next } });
      // Re-read, so the screen shows the rate trip logs will be priced at.
      await load();
      toast.success(next === null ? 'Mileage rate cleared' : 'Mileage rate saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the mileage rate'));
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const typed = value.trim();
    const amount = Number(typed);
    if (!RATE_PATTERN.test(typed) || amount <= 0 || amount > MAX_RATE) {
      setValueError(`Enter dollars a mile, up to three decimal places, more than 0 and at most ${MAX_RATE}.`);
      return;
    }
    setValueError(null);
    void save(typed);
  };

  return (
    <section className="card p-6" aria-labelledby="mileage-rate-title">
      <h2 id="mileage-rate-title" className="text-theme-text-primary text-lg font-semibold">
        Mileage rate
      </h2>
      {loadError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{loadError}</p>
      ) : !loaded ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">
          {rate
            ? `${formatCurrency(rate)} a mile (${rate}).`
            : 'Not set: members claim mileage with an amount and an uploaded log.'}
        </p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        Members can record each trip on a mileage expense instead of uploading a log; the expense is the miles at this
        rate. A line already claimed keeps the rate it was priced at.
      </p>

      {canEdit ? (
        loaded && (
          <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
            <div>
              <label htmlFor="mileage-rate" className="form-label">
                Dollars a mile
              </label>
              <input
                id="mileage-rate"
                type="text"
                inputMode="decimal"
                className="form-input w-32"
                placeholder="0.700"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={valueError ? true : undefined}
                aria-describedby={valueError ? 'mileage-rate-error' : undefined}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save rate
            </button>
            {rate && (
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void save(null)}>
                Clear rate
              </button>
            )}
            {valueError && (
              <p id="mileage-rate-error" role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
                {valueError}
              </p>
            )}
          </form>
        )
      ) : (
        <p className="text-theme-text-secondary mt-3 text-xs">
          Changing it needs the organization settings permission.
        </p>
      )}
    </section>
  );
};
