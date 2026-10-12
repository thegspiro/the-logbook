/**
 * Lock a year in its year-end close, with the Treasurer's reconciliation
 * sign-off (`finance.manage`).
 *
 * Lists what is still open — submitted requests not yet decided, approved ones
 * not yet paid or issued, budget amendments not yet confirmed or rejected —
 * because the backend refuses the lock until there is
 * nothing. The reconciliation notes are required and kept with the year. The
 * list is the backend's (`GET /fiscal-years/{id}/open-items`), not worked out
 * here, and its refusal is shown in its own words if something was submitted
 * or approved since the list was loaded.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatCurrency } from '@/utils/currencyFormatting';
import { fiscalYearService } from '../services/api';
import type { FiscalYear, FiscalYearOpenItem } from '../types';

/** The notes the API accepts. */
const MAX_NOTES = 4000;

const ITEM_PATHS: Record<FiscalYearOpenItem['kind'], string> = {
  purchase_request: '/finance/purchase-requests',
  expense_report: '/finance/expenses',
  check_request: '/finance/check-requests',
  // An amendment is decided on its line's page; the item's id is the line's.
  budget_amendment: '/finance/budgets',
};

const ITEM_KINDS: Record<FiscalYearOpenItem['kind'], string> = {
  purchase_request: 'Purchase request',
  expense_report: 'Expense report',
  check_request: 'Check request',
  budget_amendment: 'Budget amendment',
};

interface FiscalYearLockDialogProps {
  fiscalYear: Pick<FiscalYear, 'id' | 'name'>;
  onClose: () => void;
  /** Called after the year is locked; the caller re-fetches what it shows. */
  onLocked: () => void;
}

export const FiscalYearLockDialog: React.FC<FiscalYearLockDialogProps> = ({ fiscalYear, onClose, onLocked }) => {
  const [openItems, setOpenItems] = useState<FiscalYearOpenItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [notesError, setNotesError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    fiscalYearService
      .openItems(fiscalYear.id)
      .then((items) => {
        if (current) setOpenItems(items);
      })
      .catch((err: unknown) => {
        if (current) setLoadError(getErrorMessage(err, 'Could not load what is still open'));
      });
    return () => {
      current = false;
    };
  }, [fiscalYear.id]);

  const blocked = openItems === null || openItems.length > 0;

  const lock = async (signOff: string) => {
    setSaving(true);
    try {
      await fiscalYearService.lock(fiscalYear.id, { notes: signOff });
      toast.success(`${fiscalYear.name} locked`);
      onLocked();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not lock the fiscal year'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocked) return;
    const signOff = notes.trim();
    if (!signOff) {
      setNotesError('Add the reconciliation notes for the sign-off.');
      return;
    }
    setNotesError(null);
    void lock(signOff);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="lg"
      title={`Lock ${fiscalYear.name}`}
      titleId="fiscal-year-lock-title"
      aria-describedby="fiscal-year-lock-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving || blocked} className="btn-primary">
            {saving ? 'Locking...' : 'Lock the year'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="fiscal-year-lock-description" className="text-theme-text-secondary text-sm">
          Locking signs off the year&apos;s reconciliation. Nothing in {fiscalYear.name} can be paid, changed or
          reopened afterwards, and the lock cannot be undone.
        </p>

        {loadError && (
          <p role="alert" className="alert-danger text-sm">
            {loadError}
          </p>
        )}
        {openItems === null && !loadError && <p className="text-theme-text-secondary text-sm">Checking…</p>}
        {openItems !== null && openItems.length === 0 && (
          <p className="text-theme-text-secondary text-sm">Nothing is open: every request is paid, issued or closed.</p>
        )}
        {openItems !== null && openItems.length > 0 && (
          <div>
            <h3 className="form-label">
              {openItems.length} still open — pay, issue, cancel or deny {openItems.length === 1 ? 'it' : 'each'} first
            </h3>
            <ul className="divide-theme-surface-border border-theme-surface-border divide-y rounded-lg border text-sm">
              {openItems.map((item) => (
                <li key={`${item.kind}-${item.entityId}`} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
                  <Link
                    to={`${ITEM_PATHS[item.kind]}/${item.entityId}`}
                    className="font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
                  >
                    {item.number}
                  </Link>
                  <span className="text-theme-text-primary min-w-0 flex-1 break-words">{item.description}</span>
                  <span className="text-theme-text-secondary text-xs">
                    {ITEM_KINDS[item.kind]} · {item.status.replace(/_/g, ' ')} · {formatCurrency(item.amount ?? null)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label htmlFor="fiscal-year-lock-notes" className="form-label">
            Reconciliation notes
          </label>
          <textarea
            id="fiscal-year-lock-notes"
            rows={4}
            maxLength={MAX_NOTES}
            placeholder="e.g. Reconciled to the June 30 bank statement; reviewed by the audit committee"
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-invalid={Boolean(notesError)}
            aria-describedby={notesError ? 'fiscal-year-lock-notes-error' : undefined}
          />
          {notesError && (
            <p id="fiscal-year-lock-notes-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
              {notesError}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
