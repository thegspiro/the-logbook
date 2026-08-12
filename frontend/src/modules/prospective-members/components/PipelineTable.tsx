/**
 * Pipeline Table View
 *
 * Table-based view for prospective members with sorting,
 * server-side pagination, and bulk actions.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CheckSquare,
  Square,
  Forward,
  Pause,
  XCircle,
  MoreHorizontal,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApplicantListItem } from '../types';
import { APPLICANT_STATUS_COLORS, APPLICANT_STATUS_LABELS } from '../constants';
import { getInitials } from '../utils';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { ApplicantStatus as ApplicantStatusEnum } from '../../../constants/enums';
import { SortableHeader, type SortDirection } from '../../../components/ux/SortableHeader';
import { getErrorMessage } from '../../../utils/errorHandling';

interface PipelineTableProps {
  applicants: ApplicantListItem[];
  totalApplicants: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onApplicantClick: (applicant: ApplicantListItem) => void;
  selectedApplicants?: Set<string> | undefined;
  onToggleSelect?: ((id: string) => void) | undefined;
  onToggleAll?: (() => void) | undefined;
}

type SortField =
  'name' | 'email' | 'current_stage_name' | 'status' | 'days_in_stage' | 'target_membership_type' | 'created_at';

export const PipelineTable: React.FC<PipelineTableProps> = ({
  applicants,
  totalApplicants,
  currentPage,
  totalPages,
  onPageChange,
  onApplicantClick,
  selectedApplicants: externalSelected,
  onToggleSelect: externalToggle,
  onToggleAll: externalToggleAll,
}) => {
  const tz = useTimezone();
  const { advanceApplicant, holdApplicant, rejectApplicant, withdrawApplicant, isRejecting, isWithdrawing } =
    useProspectiveMembersStore();
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const selected = externalSelected ?? internalSelected;
  const noop = useCallback(() => {}, []);
  const setSelected = externalSelected ? noop : setInternalSelected;
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [showBulkRejectConfirm, setShowBulkRejectConfirm] = useState(false);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const handleSort = (field: string, direction: SortDirection) => {
    setSortField(direction ? field : null);
    setSortDirection(direction);
  };

  const sortedApplicants = useMemo(() => {
    if (!sortField || !sortDirection) return applicants;
    const sorted = [...applicants].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      switch (sortField as SortField) {
        case 'name':
          valA = `${a.first_name} ${a.last_name}`.toLowerCase();
          valB = `${b.first_name} ${b.last_name}`.toLowerCase();
          break;
        case 'email':
          valA = a.email.toLowerCase();
          valB = b.email.toLowerCase();
          break;
        case 'current_stage_name':
          valA = (a.current_stage_name ?? '').toLowerCase();
          valB = (b.current_stage_name ?? '').toLowerCase();
          break;
        case 'status':
          valA = a.status;
          valB = b.status;
          break;
        case 'days_in_stage':
          valA = a.days_in_stage;
          valB = b.days_in_stage;
          break;
        case 'target_membership_type':
          valA = a.target_membership_type;
          valB = b.target_membership_type;
          break;
        case 'created_at':
          valA = a.created_at;
          valB = b.created_at;
          break;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [applicants, sortField, sortDirection]);

  // Clear selection when page changes
  useEffect(() => {
    setSelected(new Set());
    setActionMenuId(null);
  }, [currentPage, setSelected]);

  const allSelected = applicants.length > 0 && selected.size === applicants.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll =
    externalToggleAll ??
    (() => {
      if (allSelected) {
        setSelected(new Set());
      } else {
        setSelected(new Set(applicants.map((a) => a.id)));
      }
    });

  const toggleOne =
    externalToggle ??
    ((id: string) => {
      const next = new Set(selected);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      setSelected(next);
    });

  const handleBulkAction = async (action: 'advance' | 'hold' | 'reject') => {
    const ids = Array.from(selected);
    const actionFn =
      action === 'advance'
        ? advanceApplicant
        : action === 'hold'
          ? (id: string) => holdApplicant(id)
          : (id: string) => rejectApplicant(id);

    let successCount = 0;
    for (const id of ids) {
      try {
        await actionFn(id);
        successCount++;
      } catch {
        // Continue with remaining
      }
    }

    const actionLabel = `${action.charAt(0).toUpperCase() + action.slice(1)}d`;
    if (successCount > 0) {
      toast.success(`${actionLabel} ${successCount} of ${ids.length} applicants`);
    }
    if (successCount < ids.length) {
      toast.error(`${ids.length - successCount} applicant action${ids.length - successCount === 1 ? '' : 's'} failed`);
    }
    setSelected(new Set());
  };

  const runRowAction = async (action: () => Promise<void>, successMessage: string, failureMessage: string) => {
    try {
      await action();
      toast.success(successMessage);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, failureMessage));
    }
  };

  // Generate page numbers to show
  const getPageNumbers = () => {
    const pages: number[] = [];
    const maxVisible = 5;
    let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    const end = Math.min(totalPages, start + maxVisible - 1);
    start = Math.max(1, end - maxVisible + 1);
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  };

  return (
    <div>
      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="bg-theme-surface border-theme-surface-border mb-3 flex flex-wrap items-center gap-3 rounded-lg border p-3">
          <span className="text-theme-text-secondary text-sm">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                void handleBulkAction('advance');
              }}
              aria-label={`Advance ${selected.size} selected applicant${selected.size === 1 ? '' : 's'}`}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-emerald-700"
            >
              <Forward className="h-3.5 w-3.5" />
              Advance
            </button>
            <button
              onClick={() => {
                void handleBulkAction('hold');
              }}
              aria-label={`Hold ${selected.size} selected applicant${selected.size === 1 ? '' : 's'}`}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-amber-700"
            >
              <Pause className="h-3.5 w-3.5" />
              Hold
            </button>
            <button
              onClick={() => setShowBulkRejectConfirm(true)}
              aria-label={`Reject ${selected.size} selected applicant${selected.size === 1 ? '' : 's'}`}
              className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Bulk Reject Confirmation */}
      {showBulkRejectConfirm && (
        <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
          <p className="mb-3 text-sm text-red-700 dark:text-red-300">
            Are you sure you want to reject <strong className="text-theme-text-primary">{selected.size}</strong>{' '}
            applicant(s)? This action cannot be easily undone.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setShowBulkRejectConfirm(false)}
              className="text-theme-text-secondary hover:text-theme-text-primary px-3 py-1.5 text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                void handleBulkAction('reject');
                setShowBulkRejectConfirm(false);
              }}
              className="btn-primary flex items-center gap-1 py-1.5 text-sm"
            >
              Confirm Reject All
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-theme-input-bg border-theme-surface-border overflow-hidden rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-theme-surface-border border-b">
                <th scope="col" className="w-14 p-3">
                  <button
                    onClick={toggleAll}
                    className="text-theme-text-muted hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
                  >
                    {allSelected ? (
                      <CheckSquare className="h-5 w-5 text-red-700 dark:text-red-400" />
                    ) : someSelected ? (
                      <CheckSquare className="h-5 w-5 text-red-700 dark:text-red-400/50" />
                    ) : (
                      <Square className="h-5 w-5" />
                    )}
                  </button>
                </th>
                <th className="p-3 text-left">
                  <SortableHeader
                    label="Name"
                    field="name"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="table-col-secondary p-3 text-left">
                  <SortableHeader
                    label="Email"
                    field="email"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="p-3 text-left">
                  <SortableHeader
                    label="Current Stage"
                    field="current_stage_name"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="p-3 text-left">
                  <SortableHeader
                    label="Status"
                    field="status"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="table-col-secondary p-3 text-left">
                  <SortableHeader
                    label="Days in Stage"
                    field="days_in_stage"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="table-col-tertiary p-3 text-left">
                  <SortableHeader
                    label="Target Type"
                    field="target_membership_type"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th className="table-col-tertiary p-3 text-left">
                  <SortableHeader
                    label="Applied"
                    field="created_at"
                    currentSort={sortField}
                    currentDirection={sortDirection}
                    onSort={handleSort}
                  />
                </th>
                <th scope="col" className="w-12 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {sortedApplicants.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-theme-text-muted py-12 text-center">
                    No applicants found
                  </td>
                </tr>
              ) : (
                sortedApplicants.map((applicant) => {
                  const statusColor = APPLICANT_STATUS_COLORS[applicant.status];
                  const statusLabel = APPLICANT_STATUS_LABELS[applicant.status];
                  const isSelected = selected.has(applicant.id);

                  return (
                    <tr
                      key={applicant.id}
                      className={`border-theme-surface-border hover:bg-theme-surface-secondary cursor-pointer border-b transition-colors ${
                        isSelected ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => toggleOne(applicant.id)}
                          className="text-theme-text-muted hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
                        >
                          {isSelected ? (
                            <CheckSquare className="h-5 w-5 text-red-700 dark:text-red-400" />
                          ) : (
                            <Square className="h-5 w-5" />
                          )}
                        </button>
                      </td>
                      <td className="p-3" onClick={() => onApplicantClick(applicant)}>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-red-500 to-red-700 text-xs font-bold text-white">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-theme-text-primary text-sm font-medium">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td
                        className="text-theme-text-muted table-col-secondary p-3 text-sm"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.email}
                      </td>
                      <td className="text-theme-text-secondary p-3 text-sm" onClick={() => onApplicantClick(applicant)}>
                        {applicant.current_stage_name ?? '—'}
                      </td>
                      <td className="p-3" onClick={() => onApplicantClick(applicant)}>
                        <span className={`inline-block rounded-sm px-2 py-0.5 text-xs ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                      <td
                        className="text-theme-text-muted table-col-secondary p-3 text-sm"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        <span className="flex items-center gap-1">
                          {applicant.days_in_stage}d
                          {applicant.inactivity_alert_level === 'critical' && (
                            <AlertTriangle
                              className="h-3 w-3 text-red-700 dark:text-red-400"
                              aria-label="Approaching timeout"
                            />
                          )}
                          {applicant.inactivity_alert_level === 'warning' && (
                            <AlertTriangle
                              className="h-3 w-3 text-amber-700 dark:text-amber-400"
                              aria-label="Activity slowing"
                            />
                          )}
                        </span>
                      </td>
                      <td
                        className="text-theme-text-muted table-col-tertiary p-3 text-sm capitalize"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.target_membership_type}
                      </td>
                      <td
                        className="text-theme-text-muted table-col-tertiary p-3 text-sm"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {formatDate(applicant.created_at, tz)}
                      </td>
                      <td className="relative p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setActionMenuId(actionMenuId === applicant.id ? null : applicant.id)}
                          className="text-theme-text-muted hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </button>
                        {actionMenuId === applicant.id && (
                          <div className="bg-theme-surface-modal border-theme-surface-border absolute top-full right-0 z-10 mt-1 w-40 rounded-lg border py-1 shadow-xl">
                            <button
                              onClick={() => {
                                onApplicantClick(applicant);
                                setActionMenuId(null);
                              }}
                              className="text-theme-text-secondary hover:bg-theme-surface-secondary hover:text-theme-text-primary w-full px-4 py-2 text-left text-sm"
                            >
                              View Details
                            </button>
                            {applicant.status === ApplicantStatusEnum.ACTIVE && (
                              <>
                                <button
                                  onClick={() => {
                                    void runRowAction(
                                      () => advanceApplicant(applicant.id),
                                      'Applicant advanced',
                                      'Failed to advance applicant'
                                    );
                                    setActionMenuId(null);
                                  }}
                                  className="hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm text-emerald-700 dark:text-emerald-400"
                                >
                                  Advance Stage
                                </button>
                                <button
                                  onClick={() => {
                                    void runRowAction(
                                      () => holdApplicant(applicant.id),
                                      'Applicant put on hold',
                                      'Failed to put applicant on hold'
                                    );
                                    setActionMenuId(null);
                                  }}
                                  className="hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm text-amber-700 dark:text-amber-400"
                                >
                                  Put on Hold
                                </button>
                                {withdrawConfirmId === applicant.id ? (
                                  <div className="space-y-2 px-4 py-2">
                                    <p className="text-theme-text-secondary text-xs">Confirm withdraw?</p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setWithdrawConfirmId(null)}
                                        className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          void runRowAction(
                                            () => withdrawApplicant(applicant.id),
                                            'Application withdrawn',
                                            'Failed to withdraw application'
                                          );
                                          setWithdrawConfirmId(null);
                                          setActionMenuId(null);
                                        }}
                                        disabled={isWithdrawing}
                                        className="text-theme-text-secondary hover:text-theme-text-primary flex items-center gap-1 text-xs disabled:opacity-50"
                                      >
                                        {isWithdrawing && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Confirm
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setWithdrawConfirmId(applicant.id)}
                                    className="text-theme-text-muted hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm"
                                  >
                                    Withdraw
                                  </button>
                                )}
                                {rejectConfirmId === applicant.id ? (
                                  <div className="space-y-2 px-4 py-2">
                                    <p className="text-xs text-red-700 dark:text-red-300">Confirm reject?</p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setRejectConfirmId(null)}
                                        className="text-theme-text-muted hover:text-theme-text-primary text-xs"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          void runRowAction(
                                            () => rejectApplicant(applicant.id),
                                            'Applicant rejected',
                                            'Failed to reject applicant'
                                          );
                                          setRejectConfirmId(null);
                                          setActionMenuId(null);
                                        }}
                                        disabled={isRejecting}
                                        className="flex items-center gap-1 text-xs text-red-700 hover:text-red-700 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
                                      >
                                        {isRejecting && <Loader2 className="h-3 w-3 animate-spin" />}
                                        Confirm
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setRejectConfirmId(applicant.id)}
                                    className="hover:bg-theme-surface-secondary w-full px-4 py-2 text-left text-sm text-red-700 dark:text-red-400"
                                  >
                                    Reject
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 border-t p-3">
            <p className="text-theme-text-muted text-sm">
              Page {currentPage} of {totalPages} ({totalApplicants} total)
            </p>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {getPageNumbers().map((p) => (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`h-9 min-w-[36px] rounded text-sm sm:h-10 sm:min-w-[40px] ${
                    p === currentPage
                      ? 'bg-red-600 text-white'
                      : 'text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-primary'
                  } transition-colors`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="text-theme-text-muted hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
