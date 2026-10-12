/**
 * Dual-approval threshold
 *
 * At or above this amount, a purchase request, check request or expense
 * report is approved only once two different people have approved it. The
 * value shown is the server's reading (`GET /finance/settings`), never a local
 * default, so the screen cannot claim a rule the approval path does not apply.
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`: the rule binds the finance officers themselves, so they
 * can read it here but only a settings administrator can change it — the same
 * arrangement as the admin-hours review rules.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { financeSettingsService } from '../services/api';
import type { FinanceSettings } from '../types';

/** Whole dollars, as the settings schema accepts. */
const MAX_THRESHOLD = 9_999_999_999;

export const DualApprovalSettingsCard: React.FC = () => {
  const canEdit = useAuthStore(
    (s) => s.checkPermission('settings.manage') || s.checkPermission('organization.update_settings')
  );
  const { confirm } = useConfirm();
  const [settings, setSettings] = useState<FinanceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await financeSettingsService.get();
      setSettings(next);
      setDraft(next.dualApprovalThreshold === null ? '' : String(Math.round(Number(next.dualApprovalThreshold))));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load the dual-approval rule'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (threshold: number | null) => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ finance: { dual_approval_threshold: threshold } });
      // Re-read rather than trusting the value sent, so the screen shows what
      // the approval path will actually enforce.
      await load();
      toast.success(threshold === null ? 'Dual approval turned off' : 'Dual-approval threshold saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the dual-approval rule'));
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(value) || value < 1 || value > MAX_THRESHOLD) {
      setDraftError('Enter a whole-dollar amount of $1 or more.');
      return;
    }
    setDraftError(null);
    void save(value);
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: 'Turn off dual approval',
      message: 'Every request will again be approved by a single approver, however large.',
      confirmLabel: 'Turn it off',
      cancelLabel: 'Keep it on',
      variant: 'warning',
    });
    if (ok) void save(null);
  };

  const threshold = settings?.dualApprovalThreshold ?? null;

  return (
    <section className="card p-6" aria-labelledby="dual-approval-title">
      <h2 id="dual-approval-title" className="text-theme-text-primary text-lg font-semibold">
        Second approver for large requests
      </h2>
      {loadError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-400">{loadError}</p>
      ) : settings === null ? (
        <p className="text-theme-text-secondary mt-2 text-sm">Loading…</p>
      ) : (
        <p className="text-theme-text-primary mt-2 text-sm">
          {threshold === null
            ? 'Off: one approval completes any request.'
            : `Requests of ${formatCurrency(threshold)} or more need two different approvers.`}
        </p>
      )}
      <p className="text-theme-text-secondary mt-1 text-sm">
        Applies to purchase requests, check requests and expense reports, whether or not an approval chain covers them.
        The request waits after its first approval until someone else approves it. Many departments use $1,000.
      </p>

      {canEdit ? (
        settings !== null && (
          <form onSubmit={submit} className="mt-4 flex flex-wrap items-end gap-3" noValidate>
            <div>
              <label htmlFor="dual-approval-threshold" className="form-label">
                Threshold (whole dollars)
              </label>
              <input
                id="dual-approval-threshold"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                className="form-input w-40"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-invalid={Boolean(draftError)}
                aria-describedby={draftError ? 'dual-approval-error' : undefined}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={saving}>
              Save
            </button>
            {threshold !== null && (
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void turnOff()}>
                Turn off
              </button>
            )}
            {draftError && (
              <p id="dual-approval-error" className="w-full text-xs text-red-700 dark:text-red-400">
                {draftError}
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

export default DualApprovalSettingsCard;
