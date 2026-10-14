/**
 * Cash advances in the QuickBooks export: the asset account an advance is
 * owed on and the bank account it is paid from and returned to.
 *
 * An advance's check debits the advances account; the expense reports that
 * account for it and the cash returned credit it, so its balance in
 * QuickBooks is what members still owe. The status is the backend's
 * (`readiness.advances`), so Ready is what the export accepts (CLAUDE.md
 * pitfall #29).
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import { exportMappingService } from '../services/api';
import { AdvanceExportStatus, type AdvanceExportReadiness } from '../types';

const STATUS_LABELS: Record<AdvanceExportStatus, string> = {
  [AdvanceExportStatus.READY]: 'Ready',
  [AdvanceExportStatus.NO_ADVANCES_ACCOUNT]: 'No advances account',
  [AdvanceExportStatus.NO_CASH_ACCOUNT]: 'No bank account',
  [AdvanceExportStatus.PAYABLE_RECEIVABLE]: 'Payable/receivable account',
};

const STATUS_COLORS: Record<AdvanceExportStatus, string> = {
  [AdvanceExportStatus.READY]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [AdvanceExportStatus.NO_ADVANCES_ACCOUNT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [AdvanceExportStatus.NO_CASH_ACCOUNT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [AdvanceExportStatus.PAYABLE_RECEIVABLE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

interface AdvanceExportSectionProps {
  advances: AdvanceExportReadiness;
  onSaved: (advances: AdvanceExportReadiness) => void;
}

export const AdvanceExportSection: React.FC<AdvanceExportSectionProps> = ({ advances, onSaved }) => {
  const [advancesAccount, setAdvancesAccount] = useState(advances.advancesAccount ?? '');
  const [cashAccount, setCashAccount] = useState(advances.cashAccount ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await exportMappingService.setAdvanceAccounts({
        advancesAccount: advancesAccount.trim() || null,
        cashAccount: cashAccount.trim() || null,
      });
      onSaved(next);
      toast.success('Cash advance accounts saved');
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not save the cash advance accounts.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="advance-export-heading" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="advance-export-heading" className="text-theme-text-primary text-lg font-semibold">
          Cash advances
        </h2>
        <span className={`badge ${STATUS_COLORS[advances.status]}`}>{STATUS_LABELS[advances.status]}</span>
      </div>
      <p className="text-theme-text-secondary text-sm">
        A cash advance is owed to the department on an asset account until the member accounts for it. Its check is
        posted to that account from the bank; the expense reports that account for it, and any cash returned, are posted
        back against it. An export carrying an advance is refused until both accounts are set.
      </p>
      <form onSubmit={(e) => void save(e)} className="card flex flex-wrap items-end gap-3 p-4" noValidate>
        <div>
          <label htmlFor="advances-account" className="form-label">
            Advances account
          </label>
          <input
            id="advances-account"
            type="text"
            maxLength={200}
            className="form-input"
            placeholder="Employee Advances"
            value={advancesAccount}
            onChange={(e) => setAdvancesAccount(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="advances-cash-account" className="form-label">
            Paid from and returned to
          </label>
          <input
            id="advances-cash-account"
            type="text"
            maxLength={200}
            className="form-input"
            placeholder="Operating Checking"
            value={cashAccount}
            onChange={(e) => setCashAccount(e.target.value)}
          />
        </div>
        <button type="submit" className="btn-primary" disabled={saving}>
          Save
        </button>
        {error && (
          <p role="alert" className="alert-danger w-full text-sm">
            {error}
          </p>
        )}
      </form>
    </section>
  );
};
