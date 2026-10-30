/**
 * Dues Management Page
 *
 * What members owe and have paid, by dues schedule. Everyone with
 * `finance.view` reads it (a member without `finance.manage` sees only their
 * own dues — the API confines them). A `finance.manage` holder administers
 * dues here: creates and edits schedules, generates member dues from a
 * schedule, records payments, waives and reverses waivers, and reads each
 * member's payment ledger.
 *
 * Status, paid totals and the summary are the backend's: every write re-reads
 * the list and the summary rather than adjusting them locally (pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, DollarSign, Users, Calendar, Pencil, Plus, Receipt, RefreshCw, History } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { formatCurrency } from '@/utils/currencyFormatting';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { formatDate } from '@/utils/dateFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { DuesStatus, DUES_STATUS_COLORS } from '../types';
import type { DuesSchedule, DuesSummary, MemberDues } from '../types';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { duesService } from '../services/api';
import { DuesScheduleDialog } from '../components/DuesScheduleDialog';
import { DUES_FREQUENCY_LABELS } from '../utils/dues';
import { DuesPaymentDialog } from '../components/DuesPaymentDialog';
import { DuesLedgerDialog } from '../components/DuesLedgerDialog';

// =============================================================================
// Constants
// =============================================================================

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: DuesStatus.PENDING, label: 'Pending' },
  { value: DuesStatus.PAID, label: 'Paid' },
  { value: DuesStatus.PARTIAL, label: 'Partial' },
  { value: DuesStatus.OVERDUE, label: 'Overdue' },
  { value: DuesStatus.WAIVED, label: 'Waived' },
  { value: DuesStatus.EXEMPT, label: 'Exempt' },
];

const FREQUENCY_LABELS: Record<string, string> = DUES_FREQUENCY_LABELS;

/** Statuses that still owe money, and so accept a payment or a waiver. */
const OWING: ReadonlySet<string> = new Set([DuesStatus.PENDING, DuesStatus.PARTIAL, DuesStatus.OVERDUE]);

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-xs font-medium tracking-wider uppercase';

type DialogState =
  | { kind: 'schedule'; schedule?: DuesSchedule | undefined }
  | { kind: 'payment'; dues: MemberDues }
  | { kind: 'ledger'; dues: MemberDues }
  | { kind: 'waive'; dues: MemberDues }
  | { kind: 'unwaive'; dues: MemberDues }
  | null;

const memberLabelOf = (dues: MemberDues): string => dues.memberName || 'This member';

const STATUS_LABEL_MAP: Record<string, string> = {};
for (const tab of STATUS_TABS) {
  if (tab.value) {
    STATUS_LABEL_MAP[tab.value] = tab.label;
  }
}

// =============================================================================
// Summary Cards Component
// =============================================================================

const SummaryCards: React.FC<{ summary: DuesSummary }> = ({ summary }) => (
  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <div className="card p-4">
      <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <DollarSign className="h-4 w-4" />
        Expected
      </div>
      <p className="text-theme-text-primary mt-1 text-xl font-bold">{formatCurrency(summary.totalExpected)}</p>
    </div>
    <div className="card p-4">
      <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <DollarSign className="h-4 w-4 text-green-700 dark:text-green-600" />
        Collected
      </div>
      <p className="mt-1 text-xl font-bold text-green-700 dark:text-green-600">
        {formatCurrency(summary.totalCollected)}
      </p>
    </div>
    <div className="card p-4">
      <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <DollarSign className="h-4 w-4 text-red-600" />
        Outstanding
      </div>
      <p className="mt-1 text-xl font-bold text-red-600">{formatCurrency(summary.totalOutstanding)}</p>
    </div>
    <div className="card p-4">
      <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <Users className="h-4 w-4" />
        Collection Rate
      </div>
      <p className="text-theme-text-primary mt-1 text-xl font-bold">{summary.collectionRate.toFixed(1)}%</p>
    </div>
  </div>
);

// =============================================================================
// Main Page Component
// =============================================================================

const DuesManagementPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((st) => st.checkPermission('finance.manage'));
  const {
    duesSchedules,
    memberDues,
    duesSummary,
    isLoading,
    error,
    fetchDuesSchedules,
    fetchMemberDues,
    fetchDuesSummary,
  } = useFinanceStore();

  const [selectedScheduleId, setSelectedScheduleId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  // Load schedules on mount
  useEffect(() => {
    void fetchDuesSchedules();
  }, [fetchDuesSchedules]);

  const loadDues = useCallback(() => {
    const params: { scheduleId?: string; status?: string } = {};
    if (selectedScheduleId) params.scheduleId = selectedScheduleId;
    if (statusFilter) params.status = statusFilter;
    void fetchMemberDues(Object.keys(params).length > 0 ? params : undefined);
  }, [fetchMemberDues, selectedScheduleId, statusFilter]);

  // Load member dues when schedule or status filter changes
  useEffect(() => {
    loadDues();
  }, [loadDues]);

  // Summary follows the selected schedule
  useEffect(() => {
    void fetchDuesSummary(selectedScheduleId || undefined);
  }, [fetchDuesSummary, selectedScheduleId]);

  /** Re-read everything a write can change: the list, the summary, the schedules. */
  const refresh = useCallback(() => {
    loadDues();
    void fetchDuesSummary(selectedScheduleId || undefined);
    void fetchDuesSchedules();
  }, [loadDues, fetchDuesSummary, fetchDuesSchedules, selectedScheduleId]);

  // Active schedules first; an inactive one stays listed so it can be reopened.
  const schedules = [...duesSchedules].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const selectedSchedule = duesSchedules.find((sch) => sch.id === selectedScheduleId);

  const closeDialog = () => setDialog(null);

  const handleGenerate = async (schedule: DuesSchedule) => {
    const confirmed = await confirm({
      title: 'Generate dues',
      message: `Bill every active member ${formatCurrency(schedule.amount)} under "${schedule.name}", due ${formatDate(schedule.dueDate, tz)}. Members who already have dues for this schedule are skipped, so running it again only adds members who joined since.`,
      confirmLabel: 'Generate dues',
      cancelLabel: 'Not now',
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const { generated } = await duesService.generateDues(schedule.id);
      toast.success(
        generated === 0
          ? 'Every active member already has dues for this schedule'
          : generated === 1
            ? 'Dues generated for 1 member'
            : `Dues generated for ${String(generated)} members`
      );
      refresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not generate dues'));
    } finally {
      setBusy(false);
    }
  };

  const handleWaive = async (dues: MemberDues, reason: string) => {
    setBusy(true);
    try {
      await duesService.waive(dues.id, reason);
      toast.success('Dues waived');
      closeDialog();
      refresh();
    } catch (err: unknown) {
      // Includes the backend's refusal to let a member waive their own dues.
      toast.error(getErrorMessage(err, 'Could not waive these dues'));
    } finally {
      setBusy(false);
    }
  };

  const handleUnwaive = async (dues: MemberDues, reason: string) => {
    setBusy(true);
    try {
      const restored = await duesService.unwaive(dues.id, reason);
      toast.success(`Waiver reversed — the dues are ${STATUS_LABEL_MAP[restored.status] ?? restored.status} again`);
      closeDialog();
      refresh();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not reverse the waiver'));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="page-header gap-4 sm:items-center">
      <div className="page-header-title">
        <h1 className="text-theme-text-primary text-2xl font-bold">Dues</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">What members owe and have paid, by dues schedule</p>
      </div>
      {canManage && (
        <button
          type="button"
          onClick={() => setDialog({ kind: 'schedule' })}
          className="btn-primary inline-flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New schedule
        </button>
      )}
    </div>
  );

  if (isLoading && duesSchedules.length === 0 && memberDues.length === 0) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        {header}
        <SkeletonPage rows={6} showStats />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      {header}

      {/* Error */}
      {error && (
        <div role="alert" className="alert-danger flex items-center gap-3 rounded-lg p-4 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {duesSummary && <SummaryCards summary={duesSummary} />}

      {/* Schedule Selector */}
      {schedules.length > 0 ? (
        <div className="card space-y-3 p-4">
          <h2 className="text-theme-text-secondary text-sm font-medium">Dues Schedule</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedScheduleId('')}
              aria-pressed={!selectedScheduleId}
              className={`touch-target-phone rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                !selectedScheduleId
                  ? 'bg-red-800 text-white'
                  : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border'
              }`}
            >
              All Schedules
            </button>
            {schedules.map((schedule) => (
              <button
                key={schedule.id}
                type="button"
                onClick={() => setSelectedScheduleId(schedule.id)}
                aria-pressed={selectedScheduleId === schedule.id}
                className={`touch-target-phone rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  selectedScheduleId === schedule.id
                    ? 'bg-red-800 text-white'
                    : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border'
                }`}
              >
                <span>{schedule.name}</span>
                <span className="ml-1 text-xs">
                  ({FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency}
                  {schedule.isActive ? '' : ', inactive'})
                </span>
              </button>
            ))}
          </div>
          {canManage && selectedSchedule && (
            <div className="split-row border-theme-surface-border gap-3 border-t pt-3 sm:items-center">
              <p className="split-row-main text-theme-text-secondary text-sm">
                {formatCurrency(selectedSchedule.amount)} per member, due {formatDate(selectedSchedule.dueDate, tz)}
              </p>
              <div className="split-row-aside flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleGenerate(selectedSchedule)}
                  disabled={busy || !selectedSchedule.isActive}
                  title={selectedSchedule.isActive ? undefined : 'Reactivate the schedule to generate dues from it'}
                  className="btn-primary inline-flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Generate dues
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ kind: 'schedule', schedule: selectedSchedule })}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <Pencil className="h-4 w-4" />
                  Edit schedule
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        canManage && (
          <EmptyState
            icon={Calendar}
            title="No dues schedules yet"
            description="Create a schedule for what each member owes and when, then generate dues from it."
          />
        )
      )}

      {/* Status Tabs */}
      <div className="segmented-group flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            aria-pressed={statusFilter === tab.value}
            className={`touch-target-phone rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-red-800 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Member Dues Table */}
      {memberDues.length === 0 ? (
        <EmptyState
          icon={Calendar}
          title="No dues records found"
          description={
            statusFilter || selectedScheduleId
              ? 'Try adjusting your filters.'
              : canManage
                ? 'No dues have been generated yet. Select a schedule and use Generate dues.'
                : 'No dues have been generated yet.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rwd-table w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className={`${HEADER_CELL} text-left`}>
                    Member
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    Amount Due
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    Amount Paid
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-left`}>
                    Due Date
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-left`}>
                    Status
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-left`}>
                    Paid Date
                  </th>
                  <th scope="col" className={`${HEADER_CELL} text-right`}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {memberDues.map((md) => {
                  const label = memberLabelOf(md);
                  return (
                    <tr key={md.id} className="hover:bg-theme-surface-hover transition-colors">
                      <td
                        data-label="Member"
                        className="rwd-table-lead text-theme-text-primary px-4 py-3 text-sm font-medium whitespace-nowrap"
                      >
                        {md.memberName || 'Unknown member'}
                      </td>
                      <td
                        data-label="Amount Due"
                        className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap"
                      >
                        {formatCurrency(md.amountDue)}
                      </td>
                      <td
                        data-label="Amount Paid"
                        className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap"
                      >
                        {formatCurrency(md.amountPaid)}
                      </td>
                      <td
                        data-label="Due Date"
                        className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap"
                      >
                        {formatDate(md.dueDate, tz)}
                      </td>
                      <td data-label="Status" className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DUES_STATUS_COLORS[md.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                        >
                          {STATUS_LABEL_MAP[md.status] ?? md.status}
                        </span>
                      </td>
                      <td
                        data-label="Paid Date"
                        className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap"
                      >
                        {md.paidDate ? formatDate(md.paidDate, tz) : '--'}
                      </td>
                      {/* data-label="" keeps the actions on a phone: the reflowed
                          table hides a cell with no data-label, which left a
                          treasurer no way to record a payment from one. */}
                      <td data-label="" className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="flex flex-wrap justify-end gap-2">
                          {canManage && OWING.has(md.status) && (
                            <button
                              type="button"
                              onClick={() => setDialog({ kind: 'payment', dues: md })}
                              className="btn-secondary inline-flex items-center gap-2"
                              aria-label={`Record a payment for ${label}`}
                            >
                              <Receipt className="h-4 w-4" />
                              Record payment
                            </button>
                          )}
                          {canManage && OWING.has(md.status) && (
                            <button
                              type="button"
                              onClick={() => setDialog({ kind: 'waive', dues: md })}
                              className="btn-secondary"
                              aria-label={`Waive the dues for ${label}`}
                            >
                              Waive
                            </button>
                          )}
                          {canManage && md.status === DuesStatus.WAIVED && (
                            <button
                              type="button"
                              onClick={() => setDialog({ kind: 'unwaive', dues: md })}
                              className="btn-secondary"
                              aria-label={`Reverse the waiver for ${label}`}
                            >
                              Reverse waiver
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDialog({ kind: 'ledger', dues: md })}
                            className="btn-icon"
                            aria-label={`Payment history for ${label}`}
                          >
                            <History className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog?.kind === 'schedule' && (
        <DuesScheduleDialog
          schedule={dialog.schedule}
          onClose={closeDialog}
          onSaved={(saved) => {
            closeDialog();
            if (!dialog.schedule) setSelectedScheduleId(saved.id);
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'payment' && (
        <DuesPaymentDialog
          dues={dialog.dues}
          memberLabel={memberLabelOf(dialog.dues)}
          onClose={closeDialog}
          onSaved={() => {
            closeDialog();
            refresh();
          }}
        />
      )}
      {dialog?.kind === 'ledger' && (
        <DuesLedgerDialog dues={dialog.dues} memberLabel={memberLabelOf(dialog.dues)} onClose={closeDialog} />
      )}
      <PromptDialog
        isOpen={dialog?.kind === 'waive'}
        onClose={closeDialog}
        onSubmit={(reason) => {
          if (dialog?.kind === 'waive') void handleWaive(dialog.dues, reason);
        }}
        title="Waive dues"
        message={
          dialog?.kind === 'waive'
            ? `${memberLabelOf(dialog.dues)} will no longer owe ${formatCurrency(dialog.dues.amountDue)} on this schedule. Payments cannot be recorded against waived dues until the waiver is reversed.`
            : undefined
        }
        label="Reason"
        multiline
        hint="Kept on the dues record."
        confirmLabel="Waive dues"
        cancelLabel="Keep owing"
        loading={busy}
      />
      <PromptDialog
        isOpen={dialog?.kind === 'unwaive'}
        onClose={closeDialog}
        onSubmit={(reason) => {
          if (dialog?.kind === 'unwaive') void handleUnwaive(dialog.dues, reason);
        }}
        title="Reverse waiver"
        message={
          dialog?.kind === 'unwaive'
            ? `${memberLabelOf(dialog.dues)} will owe these dues again, less anything already paid. The original waiver reason is erased.`
            : undefined
        }
        label="Why are you reversing it?"
        multiline
        hint="Required so the reversal is deliberate. It is not stored."
        confirmLabel="Reverse waiver"
        cancelLabel="Keep waiver"
        confirmVariant="warning"
        loading={busy}
      />
    </div>
  );
};

export default DuesManagementPage;
