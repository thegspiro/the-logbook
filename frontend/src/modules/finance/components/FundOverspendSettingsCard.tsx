/**
 * What happens when a payment charged to a restricted fund is more than the
 * fund has left
 *
 * A restricted fund is a fundraising campaign whose donors gave for a stated
 * purpose; spending past what they gave breaches their terms. The department
 * chooses: nothing (off), flag it to the requester and approvers and let the
 * approval through (warn, the default), or refuse the approval (block). The
 * value shown is the server's reading (`GET /finance/settings`).
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
import { FundOverspendMode } from '../types';

const MODE_LABELS: Record<FundOverspendMode, string> = {
  [FundOverspendMode.OFF]: 'Off',
  [FundOverspendMode.WARN]: 'Warn',
  [FundOverspendMode.BLOCK]: 'Block',
};

const MODE_DESCRIPTIONS: Record<FundOverspendMode, string> = {
  [FundOverspendMode.OFF]: 'Off: funds are not checked.',
  [FundOverspendMode.WARN]:
    'Warn: the requester and the approvers see how far it goes over, and it can still be approved.',
  [FundOverspendMode.BLOCK]:
    'Block: it cannot be approved, nor a purchase paid for more than its estimate, until the fund has enough.',
};

const isMode = (value: string): value is FundOverspendMode =>
  (Object.values(FundOverspendMode) as string[]).includes(value);

export const FundOverspendSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const [current, setCurrent] = useState<FundOverspendMode | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<FundOverspendMode>(FundOverspendMode.WARN);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await financeSettingsService.get();
      setCurrent(next.fundOverspendMode);
      setMode(next.fundOverspendMode);
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the restricted fund rule'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await organizationService.updateSettings({ finance: { fund_overspend_mode: mode } });
      // Re-read, so the screen shows what approvals will actually enforce.
      await load();
      toast.success('Restricted fund rule saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the restricted fund rule'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-6" aria-labelledby="fund-overspend-title">
      <h2 id="fund-overspend-title" className="text-theme-text-primary text-lg font-semibold">
        Overspending a restricted fund
      </h2>
      {loadError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{loadError}</p>
      ) : current === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">{MODE_DESCRIPTIONS[current]}</p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        A fundraising campaign marked as a restricted fund can be charged by purchase requests, check requests and
        expense lines. This decides what happens when one would spend more than the fund has left. Balances show on{' '}
        <span className="font-medium">Finance › Reports › Restricted funds</span>.
      </p>

      {canEdit ? (
        current !== null && (
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3" noValidate>
            <fieldset>
              <legend className="form-label">When a payment is more than its fund has left</legend>
              <div className="flex flex-wrap gap-4">
                {Object.values(FundOverspendMode).map((value) => (
                  <label key={value} className="text-theme-text-primary flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="fund-overspend-mode"
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

export default FundOverspendSettingsCard;
