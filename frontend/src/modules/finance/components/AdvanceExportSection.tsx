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
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { getErrorMessage } from '@/utils/errorHandling';
import type { ServerFieldSpec } from '@/utils/serverFieldErrors';
import { exportMappingService } from '../services/api';
import { AdvanceExportStatus, type AdvanceExportReadiness } from '../types';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors, type FieldErrors } from '../utils/fieldRefusals';
import { notInChartHint, UNSAFE_ACCOUNT_NAME_HINT } from '../utils/qbAccountIssues';

/** `AdvanceAccountsUpdate` (schemas/finance.py): both `max_length=200`. */
const MAX_ACCOUNT = 200;

type AdvanceField = 'advancesAccount' | 'cashAccount';

const SERVER_FIELDS: Record<AdvanceField, ServerFieldSpec> = {
  advancesAccount: { label: 'Advances account', maxLength: MAX_ACCOUNT },
  cashAccount: { label: 'Paid from and returned to', maxLength: MAX_ACCOUNT },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as AdvanceField[];
const FIELD_IDS: Record<AdvanceField, string> = {
  advancesAccount: 'advances-account',
  cashAccount: 'advances-cash-account',
};

const STATUS_LABELS: Record<AdvanceExportStatus, string> = {
  [AdvanceExportStatus.READY]: 'Ready',
  [AdvanceExportStatus.NO_ADVANCES_ACCOUNT]: 'No advances account',
  [AdvanceExportStatus.NO_CASH_ACCOUNT]: 'No bank account',
  [AdvanceExportStatus.PAYABLE_RECEIVABLE]: 'Payable/receivable account',
  [AdvanceExportStatus.UNSAFE_ACCOUNT_NAME]: 'Account name not importable',
  [AdvanceExportStatus.NOT_IN_CHART]: 'Not in chart of accounts',
};

const STATUS_COLORS: Record<AdvanceExportStatus, string> = {
  [AdvanceExportStatus.READY]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [AdvanceExportStatus.NO_ADVANCES_ACCOUNT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [AdvanceExportStatus.NO_CASH_ACCOUNT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [AdvanceExportStatus.PAYABLE_RECEIVABLE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [AdvanceExportStatus.UNSAFE_ACCOUNT_NAME]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [AdvanceExportStatus.NOT_IN_CHART]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

/** Only the two problems with an account's name need words beyond the badge. */
const accountHint = (status: AdvanceExportStatus, notInChart: readonly string[] | undefined): string =>
  status === AdvanceExportStatus.NOT_IN_CHART
    ? notInChartHint(notInChart)
    : status === AdvanceExportStatus.UNSAFE_ACCOUNT_NAME
      ? UNSAFE_ACCOUNT_NAME_HINT
      : '';

interface AdvanceExportSectionProps {
  advances: AdvanceExportReadiness;
  onSaved: (advances: AdvanceExportReadiness) => void;
}

export const AdvanceExportSection: React.FC<AdvanceExportSectionProps> = ({ advances, onSaved }) => {
  const [advancesAccount, setAdvancesAccount] = useState(advances.advancesAccount ?? '');
  const [cashAccount, setCashAccount] = useState(advances.cashAccount ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, setErrors, clearError } = useDialogFieldErrors<AdvanceField>();

  const flag = (next: FieldErrors<AdvanceField>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const values: Record<AdvanceField, string> = {
      advancesAccount: advancesAccount.trim(),
      cashAccount: cashAccount.trim(),
    };
    const tooLong: FieldErrors<AdvanceField> = {};
    for (const field of FIELD_ORDER) {
      if (values[field].length > MAX_ACCOUNT) {
        tooLong[field] = `Keep the account name to ${String(MAX_ACCOUNT)} characters.`;
      }
    }
    if (!flag(tooLong)) return;
    setSaving(true);
    try {
      // Both keys are required on the PUT (blank clears one), so this is a
      // whole replace: a refused field keeps the pair unsaved rather than
      // saving around it (forms review F-6 single-save rule, replace case).
      const next = await exportMappingService.setAdvanceAccounts({
        advancesAccount: values.advancesAccount || null,
        cashAccount: values.cashAccount || null,
      });
      onSaved(next);
      toast.success('Cash advance accounts saved');
    } catch (err: unknown) {
      const mapped = refusalsOnFields(err, SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        setError(
          mapped.unmatched.length > 0 ? mapped.unmatched.join(' ') : 'Nothing was saved. Fix the flagged account.'
        );
        return;
      }
      // A payable or receivable account is a 400 that names no field; it is
      // said here, beside the fields, not only in a toast (forms review F-3).
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
      {accountHint(advances.status, advances.accountsNotInChart) && (
        <p className="alert-warning rounded-lg p-3 text-sm">
          {accountHint(advances.status, advances.accountsNotInChart)}
        </p>
      )}
      <p className="text-theme-text-secondary text-sm">
        A cash advance is owed to the department on an asset account until the member accounts for it. Its check is
        posted to that account from the bank; the expense reports that account for it, and any cash returned, are posted
        back against it. An export carrying an advance is refused until both accounts are set.
      </p>
      <form onSubmit={(e) => void save(e)} className="card flex flex-wrap items-end gap-3 p-4" noValidate>
        <FormField
          id={FIELD_IDS.advancesAccount}
          label="Advances account"
          error={errors.advancesAccount}
          maxLength={MAX_ACCOUNT}
          count={advancesAccount.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="Employee Advances"
              value={advancesAccount}
              onChange={(e) => {
                setAdvancesAccount(e.target.value);
                clearError('advancesAccount');
              }}
            />
          )}
        </FormField>
        <FormField
          id={FIELD_IDS.cashAccount}
          label="Paid from and returned to"
          error={errors.cashAccount}
          maxLength={MAX_ACCOUNT}
          count={cashAccount.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="Operating Checking"
              value={cashAccount}
              onChange={(e) => {
                setCashAccount(e.target.value);
                clearError('cashAccount');
              }}
            />
          )}
        </FormField>
        <button type="submit" className="btn-primary" disabled={saving}>
          Save
        </button>
        {error && (
          <p role="alert" className={`w-full text-sm ${FIELD_ERROR_CLASS}`}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
};
