/**
 * Dues in the QuickBooks export: the department's default accounts, and what
 * each dues schedule's payments post to.
 *
 * Each dues payment is an entry debiting the account it was deposited to and
 * crediting an income account. A schedule names its own on its dialog (Finance
 * › Dues); one it leaves blank takes the defaults set here. The table is the
 * backend's resolution (`readiness.dues`), so a schedule shown Ready is one the
 * export accepts (CLAUDE.md pitfall #29).
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { getErrorMessage } from '@/utils/errorHandling';
import type { ServerFieldSpec } from '@/utils/serverFieldErrors';
import { exportMappingService } from '../services/api';
import { DuesExportStatus, type DuesExportReadiness, type DuesScheduleExport } from '../types';
import { firstErrorField, refusalsOnFields, useDialogFieldErrors, type FieldErrors } from '../utils/fieldRefusals';
import { notInChartHint, UNSAFE_ACCOUNT_NAME_HINT } from '../utils/qbAccountIssues';

/** `DuesDefaultAccountsUpdate` (schemas/finance.py): both `max_length=200`. */
const MAX_ACCOUNT = 200;

type DuesField = 'incomeAccount' | 'depositAccount';

const SERVER_FIELDS: Record<DuesField, ServerFieldSpec> = {
  incomeAccount: { label: 'Default income account', maxLength: MAX_ACCOUNT },
  depositAccount: { label: 'Default deposited to', maxLength: MAX_ACCOUNT },
};
const FIELD_ORDER = Object.keys(SERVER_FIELDS) as DuesField[];
const FIELD_IDS: Record<DuesField, string> = {
  incomeAccount: 'dues-default-income',
  depositAccount: 'dues-default-deposit',
};

const STATUS_LABELS: Record<DuesExportStatus, string> = {
  [DuesExportStatus.READY]: 'Ready',
  [DuesExportStatus.NO_INCOME]: 'No income account',
  [DuesExportStatus.NO_DEPOSIT]: 'No deposit account',
  [DuesExportStatus.PAYABLE_RECEIVABLE]: 'Payable/receivable account',
  [DuesExportStatus.UNSAFE_ACCOUNT_NAME]: 'Account name not importable',
  [DuesExportStatus.NOT_IN_CHART]: 'Not in chart of accounts',
};

const STATUS_COLORS: Record<DuesExportStatus, string> = {
  [DuesExportStatus.READY]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [DuesExportStatus.NO_INCOME]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [DuesExportStatus.NO_DEPOSIT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [DuesExportStatus.PAYABLE_RECEIVABLE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [DuesExportStatus.UNSAFE_ACCOUNT_NAME]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [DuesExportStatus.NOT_IN_CHART]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

/** Only the two problems with an account's name need words beyond the badge. */
const accountHint = (status: DuesExportStatus, notInChart: readonly string[] | undefined): string =>
  status === DuesExportStatus.NOT_IN_CHART
    ? notInChartHint(notInChart)
    : status === DuesExportStatus.UNSAFE_ACCOUNT_NAME
      ? UNSAFE_ACCOUNT_NAME_HINT
      : '';

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';

const AccountCell: React.FC<{ account?: string | null | undefined; source?: string | null | undefined }> = ({
  account,
  source,
}) =>
  account ? (
    <>
      {account}
      <span className="text-theme-text-secondary block text-xs">
        {source === 'schedule' ? 'Set on the schedule' : 'Department default'}
      </span>
    </>
  ) : (
    <span className="text-theme-text-secondary">None</span>
  );

interface DuesExportSectionProps {
  dues: DuesExportReadiness;
  onSaved: (dues: DuesExportReadiness) => void;
}

export const DuesExportSection: React.FC<DuesExportSectionProps> = ({ dues, onSaved }) => {
  const [income, setIncome] = useState(dues.defaultIncomeAccount ?? '');
  const [deposit, setDeposit] = useState(dues.defaultDepositAccount ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, setErrors, clearError } = useDialogFieldErrors<DuesField>();

  const flag = (next: FieldErrors<DuesField>) => {
    setErrors(next);
    const first = firstErrorField(next, FIELD_ORDER);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const values: Record<DuesField, string> = { incomeAccount: income.trim(), depositAccount: deposit.trim() };
    const tooLong: FieldErrors<DuesField> = {};
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
      const next = await exportMappingService.setDuesDefaults({
        incomeAccount: values.incomeAccount || null,
        depositAccount: values.depositAccount || null,
      });
      onSaved(next);
      toast.success('Dues accounts saved');
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
      setError(getErrorMessage(err, 'Could not save the dues accounts.'));
    } finally {
      setSaving(false);
    }
  };

  const row = (schedule: DuesScheduleExport) => (
    <tr key={schedule.scheduleId}>
      <td data-label="Schedule" className={`rwd-table-lead ${CELL} font-medium`}>
        {schedule.name}
        {!schedule.isActive && <span className="text-theme-text-secondary"> (inactive)</span>}
      </td>
      <td data-label="Income account" className={CELL}>
        <AccountCell account={schedule.incomeAccount} source={schedule.incomeSource} />
      </td>
      <td data-label="Deposited to" className={CELL}>
        <AccountCell account={schedule.depositAccount} source={schedule.depositSource} />
      </td>
      <td data-label="Status" className={CELL}>
        <div className="min-w-0">
          <span className={`badge ${STATUS_COLORS[schedule.status]}`}>{STATUS_LABELS[schedule.status]}</span>
          {accountHint(schedule.status, schedule.accountsNotInChart) && (
            <span className="text-theme-text-secondary mt-1 block text-xs">
              {accountHint(schedule.status, schedule.accountsNotInChart)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <section aria-labelledby="dues-export-heading" className="space-y-3">
      <h2 id="dues-export-heading" className="text-theme-text-primary text-lg font-semibold">
        Dues
      </h2>
      <p className="text-theme-text-secondary text-sm">
        Each dues payment is exported as money deposited to a bank account and credited to an income account. A schedule
        can name its own on{' '}
        <Link to="/finance/dues" className="text-red-700 hover:underline dark:text-red-400">
          Dues
        </Link>
        ; the rest use these defaults. An export with dues from a schedule that has neither is refused.
      </p>
      {!dues.enabled && (
        <p className="alert-info text-sm">
          Dues are not exported yet. They will be once you set an account here or on a schedule.
        </p>
      )}
      <form onSubmit={(e) => void save(e)} className="card flex flex-wrap items-end gap-3 p-4" noValidate>
        <FormField
          id={FIELD_IDS.incomeAccount}
          label="Default income account"
          error={errors.incomeAccount}
          maxLength={MAX_ACCOUNT}
          count={income.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="Dues Income"
              value={income}
              onChange={(e) => {
                setIncome(e.target.value);
                clearError('incomeAccount');
              }}
            />
          )}
        </FormField>
        <FormField
          id={FIELD_IDS.depositAccount}
          label="Default deposited to"
          error={errors.depositAccount}
          maxLength={MAX_ACCOUNT}
          count={deposit.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              className="form-input"
              placeholder="Operating Checking"
              value={deposit}
              onChange={(e) => {
                setDeposit(e.target.value);
                clearError('depositAccount');
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
      {dues.schedules.length === 0 ? (
        <p className="text-theme-text-secondary text-sm">No dues schedules yet.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="rwd-table w-full">
            <thead className="border-theme-surface-border border-b">
              <tr>
                <th scope="col" className={HEADER_CELL}>
                  Schedule
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Income account
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Deposited to
                </th>
                <th scope="col" className={HEADER_CELL}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">{dues.schedules.map(row)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default DuesExportSection;
