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
import { getErrorMessage } from '@/utils/errorHandling';
import { exportMappingService } from '../services/api';
import { DuesExportStatus, type DuesExportReadiness, type DuesScheduleExport } from '../types';

const STATUS_LABELS: Record<DuesExportStatus, string> = {
  [DuesExportStatus.READY]: 'Ready',
  [DuesExportStatus.NO_INCOME]: 'No income account',
  [DuesExportStatus.NO_DEPOSIT]: 'No deposit account',
  [DuesExportStatus.PAYABLE_RECEIVABLE]: 'Payable/receivable account',
};

const STATUS_COLORS: Record<DuesExportStatus, string> = {
  [DuesExportStatus.READY]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [DuesExportStatus.NO_INCOME]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [DuesExportStatus.NO_DEPOSIT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [DuesExportStatus.PAYABLE_RECEIVABLE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const next = await exportMappingService.setDuesDefaults({
        incomeAccount: income.trim() || null,
        depositAccount: deposit.trim() || null,
      });
      onSaved(next);
      toast.success('Dues accounts saved');
    } catch (err: unknown) {
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
        <span className={`badge ${STATUS_COLORS[schedule.status]}`}>{STATUS_LABELS[schedule.status]}</span>
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
        <div>
          <label htmlFor="dues-default-income" className="form-label">
            Default income account
          </label>
          <input
            id="dues-default-income"
            type="text"
            maxLength={200}
            className="form-input"
            placeholder="Dues Income"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="dues-default-deposit" className="form-label">
            Default deposited to
          </label>
          <input
            id="dues-default-deposit"
            type="text"
            maxLength={200}
            className="form-input"
            placeholder="Operating Checking"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
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
