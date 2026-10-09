/**
 * QuickBooks Export Settings Page
 *
 * Where a Treasurer gives each budget category the two QuickBooks accounts the
 * export needs: the account its spending posts to and the account it is paid
 * from. Protected by finance.manage, the gate on the mapping endpoints.
 *
 * The readiness table is the backend's answer (`GET /finance/export/readiness`),
 * computed by the same classifier the export runs, so a category shown ready
 * is one the export accepts. This page does not decide readiness, which
 * account wins, or which mappings match a category (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, ArrowLeft, CheckCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { EmptyState } from '@/components/ux/EmptyState';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { exportMappingService } from '../services/api';
import { ExportMappingDialog } from '../components/ExportMappingDialog';
import { ExportReadinessStatus } from '../types';
import type { ExportMapping, ExportReadiness, ExportReadinessCategory } from '../types';

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';

const STATUS_LABELS: Record<ExportReadinessStatus, string> = {
  [ExportReadinessStatus.READY]: 'Ready',
  [ExportReadinessStatus.NO_ACCOUNT]: 'No account',
  [ExportReadinessStatus.NO_OFFSET]: 'No paid-from account',
  [ExportReadinessStatus.DUPLICATE_MAPPINGS]: 'More than one mapping',
  [ExportReadinessStatus.PAYABLE_RECEIVABLE]: 'Payable/receivable account',
};

const STATUS_COLORS: Record<ExportReadinessStatus, string> = {
  [ExportReadinessStatus.READY]: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  [ExportReadinessStatus.NO_ACCOUNT]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [ExportReadinessStatus.NO_OFFSET]: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  [ExportReadinessStatus.DUPLICATE_MAPPINGS]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  [ExportReadinessStatus.PAYABLE_RECEIVABLE]: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

/** What the Treasurer does about a category in each state. */
const STATUS_HINTS: Record<ExportReadinessStatus, string> = {
  [ExportReadinessStatus.READY]: '',
  [ExportReadinessStatus.NO_ACCOUNT]: 'Add a mapping, or name an account on the category.',
  [ExportReadinessStatus.NO_OFFSET]: 'Add the account it is paid from to its mapping.',
  [ExportReadinessStatus.DUPLICATE_MAPPINGS]: 'Delete all but one of its mappings below.',
  [ExportReadinessStatus.PAYABLE_RECEIVABLE]:
    "QuickBooks can't import journal lines to Accounts Payable or Receivable without a vendor or customer. Use the bank or card account it is paid from, and an expense account.",
};

/** The account a category posts to, and whether it or its mapping supplies it. */
const AccountCell: React.FC<{ row: ExportReadinessCategory }> = ({ row }) =>
  row.accountName ? (
    <>
      {row.accountName}
      <span className="text-theme-text-secondary block text-xs">
        {row.accountSource === 'category' ? 'Set on the category' : 'From its mapping'}
      </span>
    </>
  ) : (
    <span className="text-theme-text-secondary">None</span>
  );

type DialogState = { mode: 'create'; initialCategory?: string } | { mode: 'edit'; mapping: ExportMapping } | null;

const QuickBooksExportSettingsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const [readiness, setReadiness] = useState<ExportReadiness | null>(null);
  const [mappings, setMappings] = useState<ExportMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextReadiness, nextMappings] = await Promise.all([
        exportMappingService.readiness(),
        exportMappingService.list(),
      ]);
      setReadiness(nextReadiness);
      setMappings(nextMappings);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the QuickBooks export settings.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (mapping: ExportMapping) => {
    const confirmed = await confirm({
      title: 'Delete mapping',
      message: `Delete the mapping for ${mapping.internalCategory} to ${mapping.qbAccountName}? Exports stop posting this category through it. If it is the category's only mapping, exports that include the category are refused until it has another.`,
      confirmLabel: 'Delete mapping',
      cancelLabel: 'Keep it',
    });
    if (!confirmed) return;
    setDeletingId(mapping.id);
    try {
      await exportMappingService.delete(mapping.id);
      toast.success('Mapping deleted');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the mapping.'));
    } finally {
      setDeletingId(null);
    }
  };

  const header = (
    <>
      <Link
        to="/finance/settings"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">QuickBooks Export</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Give each budget category the QuickBooks account it posts to and the account it is paid from
          </p>
        </div>
        <button type="button" onClick={() => setDialog({ mode: 'create' })} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add mapping
        </button>
      </div>
    </>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        {header}
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  const categories = readiness?.categories ?? [];
  const unmatched = new Set(readiness?.unmatchedMappingIds ?? []);
  const blocking = categories.filter((c) => c.status !== ExportReadinessStatus.READY);
  const categoryNames = categories.map((c) => c.categoryName);

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      {header}

      {error && (
        <div role="alert" className="alert-danger flex items-center gap-3 rounded-lg p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {readiness && categories.length > 0 && (
        <div
          role="status"
          className={`flex items-start gap-3 rounded-lg p-4 text-sm ${blocking.length > 0 ? 'alert-warning' : 'alert-success'}`}
        >
          {blocking.length > 0 ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <p>
            {blocking.length === 0
              ? 'Every budget category has both accounts. Exports can post all of them.'
              : blocking.length === 1
                ? '1 budget category needs its accounts fixed. An export that includes its spending is refused until it is.'
                : `${String(blocking.length)} budget categories need their accounts fixed. An export that includes their spending is refused until they are.`}
          </p>
        </div>
      )}

      {/* Readiness, per category */}
      <section aria-labelledby="readiness-heading" className="space-y-3">
        <h2 id="readiness-heading" className="text-theme-text-primary text-lg font-semibold">
          Budget categories
        </h2>
        {readiness && categories.length === 0 ? (
          <EmptyState
            title="No budget categories yet"
            description="Create budget categories in Finance Settings, then map each one to its QuickBooks accounts here."
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="rwd-table w-full">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th scope="col" className={HEADER_CELL}>
                      Category
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      Posts to
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      Paid from
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      Status
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((row) => {
                    const onlyMapping =
                      row.mappingIds.length === 1 ? mappings.find((m) => m.id === row.mappingIds[0]) : undefined;
                    return (
                      <tr key={row.categoryId} className="border-theme-surface-border border-b last:border-b-0">
                        <td data-label="Category" className={`rwd-table-lead ${CELL} font-medium`}>
                          {row.categoryName}
                          {!row.isActive && (
                            <span className="text-theme-text-secondary block text-xs font-normal">Inactive</span>
                          )}
                        </td>
                        <td data-label="Posts to" className={CELL}>
                          <AccountCell row={row} />
                        </td>
                        <td data-label="Paid from" className={CELL}>
                          {row.offsetAccountName ?? <span className="text-theme-text-secondary">None</span>}
                        </td>
                        <td data-label="Status" className={CELL}>
                          <span className={`badge ${STATUS_COLORS[row.status]}`}>{STATUS_LABELS[row.status]}</span>
                          {STATUS_HINTS[row.status] && (
                            <span className="text-theme-text-secondary mt-1 block text-xs">
                              {STATUS_HINTS[row.status]}
                            </span>
                          )}
                        </td>
                        <td className={`${CELL} text-right`}>
                          {onlyMapping ? (
                            <button
                              type="button"
                              onClick={() => setDialog({ mode: 'edit', mapping: onlyMapping })}
                              className="btn-secondary"
                              aria-label={`Edit the mapping for ${row.categoryName}`}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit mapping
                            </button>
                          ) : row.mappingIds.length === 0 ? (
                            <button
                              type="button"
                              onClick={() => setDialog({ mode: 'create', initialCategory: row.categoryName })}
                              className="btn-secondary"
                              aria-label={`Add a mapping for ${row.categoryName}`}
                            >
                              <Plus className="h-4 w-4" />
                              Add mapping
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Every mapping, including ones that match no category */}
      <section aria-labelledby="mappings-heading" className="space-y-3">
        <h2 id="mappings-heading" className="text-theme-text-primary text-lg font-semibold">
          Mappings
        </h2>
        {mappings.length === 0 ? (
          <EmptyState
            title="No mappings yet"
            description="Add a mapping for each budget category to give it the account it is paid from."
          />
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="rwd-table w-full">
                <thead>
                  <tr className="border-theme-surface-border border-b">
                    <th scope="col" className={HEADER_CELL}>
                      Category
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      QuickBooks account
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      Paid from
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      Type
                    </th>
                    <th scope="col" className={HEADER_CELL}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((mapping) => (
                    <tr key={mapping.id} className="border-theme-surface-border border-b last:border-b-0">
                      <td data-label="Category" className={`rwd-table-lead ${CELL} font-medium`}>
                        {mapping.internalCategory}
                        {unmatched.has(mapping.id) && (
                          <span className="mt-1 block text-xs font-normal text-amber-800 dark:text-amber-300">
                            Matches no budget category, so exports never use it
                          </span>
                        )}
                      </td>
                      <td data-label="QuickBooks account" className={CELL}>
                        {mapping.qbAccountName}
                        {mapping.qbAccountNumber && (
                          <span className="text-theme-text-secondary block text-xs">No. {mapping.qbAccountNumber}</span>
                        )}
                      </td>
                      <td data-label="Paid from" className={CELL}>
                        {mapping.qbOffsetAccountName || <span className="text-theme-text-secondary">None</span>}
                      </td>
                      <td data-label="Type" className={`${CELL} capitalize`}>
                        {mapping.mappingType}
                      </td>
                      <td className={`${CELL} text-right`}>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDialog({ mode: 'edit', mapping })}
                            className="btn-icon"
                            aria-label={`Edit the mapping for ${mapping.internalCategory} to ${mapping.qbAccountName}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDelete(mapping)}
                            disabled={deletingId === mapping.id}
                            className="btn-icon text-red-700 dark:text-red-400"
                            aria-label={`Delete the mapping for ${mapping.internalCategory} to ${mapping.qbAccountName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* What QuickBooks itself needs before an import (Intuit, "Import journal entries") */}
      <section aria-labelledby="import-checklist-heading" className="card space-y-2 p-6">
        <h2 id="import-checklist-heading" className="text-theme-text-primary text-lg font-semibold">
          Before you import into QuickBooks Online
        </h2>
        <p className="text-theme-text-secondary text-sm">
          The export is a QuickBooks Online journal-entry file. Import it under Settings › Import data › Journal
          entries, after setting up QuickBooks as follows:
        </p>
        <ul className="text-theme-text-primary list-disc space-y-1 pl-5 text-sm">
          <li>Every account named here exists in your chart of accounts, spelled the same.</li>
          <li>
            Account numbers are turned off while you import (Settings › Account and settings › Advanced › Chart of
            accounts).
          </li>
          <li>
            &ldquo;Warn if duplicate journal number is used&rdquo; is turned off, since each entry carries its request
            number.
          </li>
          <li>When mapping the file, choose the MM/DD/YYYY date format.</li>
          <li>
            Each file holds fewer than 1,000 rows, QuickBooks&apos; limit; a longer period is refused here, so export it
            in parts.
          </li>
        </ul>
      </section>

      {dialog && (
        <ExportMappingDialog
          mapping={dialog.mode === 'edit' ? dialog.mapping : undefined}
          initialCategory={dialog.mode === 'create' ? dialog.initialCategory : undefined}
          categoryNames={categoryNames}
          onClose={() => setDialog(null)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
};

export default QuickBooksExportSettingsPage;
