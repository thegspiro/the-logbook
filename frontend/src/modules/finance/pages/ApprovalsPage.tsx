/**
 * Approvals Page
 *
 * The finance requests waiting on an approval step the viewer is the named
 * approver of, one row per request, with Approve and Deny for that step.
 *
 * Which rows appear, and whether each is the viewer's own or one an approvals
 * admin can act on only with an override reason, is the backend's decision
 * (`canAct` / `requiresOverride`, from finance_approver_matching.py). This page
 * shows those flags and does not re-derive who matches a step.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle, ClipboardCheck, XCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatDate } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import type { PendingApproval } from '../types';
import { ApprovalDecisionDialog } from '../components/ApprovalDecisionDialog';
import type { ApprovalDecision } from '../components/ApprovalDecisionDialog';
import { APPROVAL_ENTITY_LABELS, approvalEntityPath } from '../components/approvalEntities';

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';

const PageHeader: React.FC = () => {
  // Only the copy depends on this: the rows, and whether each needs an
  // override, come from the API.
  const isApprovalsAdmin = useAuthStore((s) => s.checkPermission('finance.configure_approvals'));
  return (
    <div>
      <h1 className="text-theme-text-primary text-2xl font-bold">Approvals</h1>
      <p className="text-theme-text-secondary mt-1 text-sm">Requests waiting on you.</p>
      {isApprovalsAdmin && (
        <p className="text-theme-text-secondary mt-1 text-sm">
          As an approvals administrator you also see steps assigned to other people. To approve or deny one of those,
          you must give a reason, which is recorded in the audit log.
        </p>
      )}
    </div>
  );
};

interface RowActionsProps {
  row: PendingApproval;
  onOpen: (row: PendingApproval, action: ApprovalDecision['action']) => void;
}

const RowActions: React.FC<RowActionsProps> = ({ row, onOpen }) => {
  if (row.canAct) {
    return (
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpen(row, 'approve')}
          aria-label={`Approve ${row.entityTitle}`}
          className="btn-success inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
        >
          <CheckCircle className="h-4 w-4" />
          Approve
        </button>
        <button
          type="button"
          onClick={() => onOpen(row, 'deny')}
          aria-label={`Deny ${row.entityTitle}`}
          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400"
        >
          <XCircle className="h-4 w-4" />
          Deny
        </button>
      </div>
    );
  }
  if (!row.requiresOverride) return null;
  // Secondary style for both: acting on someone else's step is the exception
  // to the chain, and should not look like the normal path.
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button
        type="button"
        onClick={() => onOpen(row, 'approve')}
        aria-label={`Approve ${row.entityTitle} as approvals admin`}
        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
      >
        <CheckCircle className="h-4 w-4" />
        Approve as admin
      </button>
      <button
        type="button"
        onClick={() => onOpen(row, 'deny')}
        aria-label={`Deny ${row.entityTitle} as approvals admin`}
        className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400"
      >
        <XCircle className="h-4 w-4" />
        Deny as admin
      </button>
    </div>
  );
};

const ApprovalsPage: React.FC = () => {
  const tz = useTimezone();
  const { pendingApprovals, error, fetchPendingApprovals } = useFinanceStore();
  const [loaded, setLoaded] = useState(false);
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);

  useEffect(() => {
    // fetchPendingApprovals never rejects — a failure lands in `error`.
    void fetchPendingApprovals().finally(() => setLoaded(true));
  }, [fetchPendingApprovals]);

  const open = (row: PendingApproval, action: ApprovalDecision['action']) =>
    setDecision({
      stepRecordId: row.stepRecordId,
      action,
      subject: `${row.entityTitle} (${APPROVAL_ENTITY_LABELS[row.entityType].toLowerCase()})`,
      stepName: row.stepName,
      override: !row.canAct && row.requiresOverride ? { assigneeLabel: row.assigneeLabel } : undefined,
    });

  if (!loaded) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <PageHeader />
        <SkeletonPage rows={5} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <PageHeader />

      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {pendingApprovals.length === 0 ? (
        // A failed load is reported above; "nothing waiting" would be a claim
        // this page cannot make without the list.
        !error && (
          <EmptyState
            icon={ClipboardCheck}
            title="Nothing is waiting on you."
            description="Purchase requests, expense reports and check requests show up here when they reach an approval step assigned to you."
          />
        )
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rwd-table w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className={HEADER_CELL}>
                    Request
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Type
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Requested by
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    Amount
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Step
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Waiting on
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Submitted
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {pendingApprovals.map((row) => (
                  <tr key={row.stepRecordId}>
                    <td data-label="Request" className="rwd-table-lead px-4 py-3 text-sm font-medium">
                      <Link
                        to={approvalEntityPath(row.entityType, row.entityId)}
                        className="text-red-700 hover:underline dark:text-red-400"
                      >
                        {row.entityTitle}
                      </Link>
                    </td>
                    <td data-label="Type" className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                      {APPROVAL_ENTITY_LABELS[row.entityType]}
                    </td>
                    <td data-label="Requested by" className="text-theme-text-primary px-4 py-3 text-sm">
                      {row.requesterName}
                    </td>
                    <td
                      data-label="Amount"
                      className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap"
                    >
                      {formatCurrency(row.entityAmount)}
                    </td>
                    <td data-label="Step" className="text-theme-text-primary px-4 py-3 text-sm">
                      {row.stepName}
                    </td>
                    <td data-label="Waiting on" className="text-theme-text-primary px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{row.assigneeLabel}</span>
                        {!row.canAct && row.requiresOverride && (
                          <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                            Not assigned to you
                          </span>
                        )}
                      </div>
                    </td>
                    <td
                      data-label="Submitted"
                      className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap"
                    >
                      {formatDate(row.submittedAt, tz)}
                    </td>
                    <td data-label="Decision" className="px-4 py-3">
                      <RowActions row={row} onOpen={open} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ApprovalDecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
};

export default ApprovalsPage;
