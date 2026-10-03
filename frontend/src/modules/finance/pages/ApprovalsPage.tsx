/**
 * Approvals Page
 *
 * Every finance request currently waiting on an approval step, one row per
 * request, with Approve and Deny for that step.
 *
 * The list is organization-wide, not "assigned to me": the backend lets any
 * holder of `finance.approve` act on any step, whoever the chain names as the
 * approver, so the copy here must not suggest otherwise.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle, ClipboardCheck, XCircle } from 'lucide-react';
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

const PageHeader: React.FC = () => (
  <div>
    <h1 className="text-theme-text-primary text-2xl font-bold">Approvals</h1>
    <p className="text-theme-text-secondary mt-1 text-sm">
      Requests waiting on an approval step. Anyone with finance approval permission can approve or deny them.
    </p>
  </div>
);

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
            title="Nothing waiting for approval"
            description="Purchase requests, expense reports and check requests show up here when they reach an approval step."
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
                    <td
                      data-label="Submitted"
                      className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap"
                    >
                      {formatDate(row.submittedAt, tz)}
                    </td>
                    <td data-label="Decision" className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => open(row, 'approve')}
                          aria-label={`Approve ${row.entityTitle}`}
                          className="btn-success inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
                        >
                          <CheckCircle className="h-4 w-4" />
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => open(row, 'deny')}
                          aria-label={`Deny ${row.entityTitle}`}
                          className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 dark:text-red-400"
                        >
                          <XCircle className="h-4 w-4" />
                          Deny
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

      <ApprovalDecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
};

export default ApprovalsPage;
