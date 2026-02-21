/**
 * Pipeline Table View
 *
 * Table-based view for prospective members with sorting,
 * server-side pagination, and bulk actions.
 */

import React, { useState, useEffect } from 'react';
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
import type { ApplicantListItem, ApplicantStatus } from '../types';
import { getInitials } from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';

interface PipelineTableProps {
  applicants: ApplicantListItem[];
  totalApplicants: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onApplicantClick: (applicant: ApplicantListItem) => void;
}

const STATUS_BADGES: Record<ApplicantStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400' },
  on_hold: { label: 'On Hold', className: 'bg-amber-500/20 text-amber-700 dark:text-amber-400' },
  withdrawn: { label: 'Withdrawn', className: 'bg-theme-surface-hover text-theme-text-muted' },
  converted: { label: 'Converted', className: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/20 text-red-700 dark:text-red-400' },
  inactive: { label: 'Inactive', className: 'bg-theme-surface-hover text-theme-text-muted' },
};

export const PipelineTable: React.FC<PipelineTableProps> = ({
  applicants,
  totalApplicants,
  currentPage,
  totalPages,
  onPageChange,
  onApplicantClick,
}) => {
  const tz = useTimezone();
  const { advanceApplicant, holdApplicant, rejectApplicant, withdrawApplicant, isRejecting, isWithdrawing } =
    useProspectiveMembersStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [showBulkRejectConfirm, setShowBulkRejectConfirm] = useState(false);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
  const [withdrawConfirmId, setWithdrawConfirmId] = useState<string | null>(null);

  // Clear selection when page changes
  useEffect(() => {
    setSelected(new Set());
    setActionMenuId(null);
  }, [currentPage]);

  const allSelected =
    applicants.length > 0 && selected.size === applicants.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(applicants.map((a) => a.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

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

    toast.success(
      `${action.charAt(0).toUpperCase() + action.slice(1)}d ${successCount} of ${ids.length} applicants`
    );
    setSelected(new Set());
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
        <div className="mb-3 flex items-center gap-3 p-3 bg-theme-surface border border-theme-surface-border rounded-lg">
          <span className="text-sm text-theme-text-secondary">
            {selected.size} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => handleBulkAction('advance')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
            >
              <Forward className="w-3.5 h-3.5" />
              Advance
            </button>
            <button
              onClick={() => handleBulkAction('hold')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors"
            >
              <Pause className="w-3.5 h-3.5" />
              Hold
            </button>
            <button
              onClick={() => setShowBulkRejectConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Bulk Reject Confirmation */}
      {showBulkRejectConfirm && (
        <div className="mb-3 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-700 dark:text-red-300 mb-3">
            Are you sure you want to reject <strong className="text-theme-text-primary">{selected.size}</strong> applicant(s)? This action cannot be easily undone.
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setShowBulkRejectConfirm(false)}
              className="px-3 py-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                handleBulkAction('reject');
                setShowBulkRejectConfirm(false);
              }}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              Confirm Reject All
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-theme-input-bg border border-theme-surface-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-theme-surface-border">
                <th className="w-10 p-3">
                  <button onClick={toggleAll} className="text-theme-text-muted hover:text-theme-text-primary">
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-red-700 dark:text-red-400" />
                    ) : someSelected ? (
                      <CheckSquare className="w-4 h-4 text-red-700 dark:text-red-400/50" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Name
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Current Stage
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Days in Stage
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Target Type
                </th>
                <th className="text-left p-3 text-xs font-medium text-theme-text-muted uppercase tracking-wider">
                  Applied
                </th>
                <th className="w-12 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {applicants.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-theme-text-muted">
                    No applicants found
                  </td>
                </tr>
              ) : (
                applicants.map((applicant) => {
                  const statusBadge = STATUS_BADGES[applicant.status];
                  const isSelected = selected.has(applicant.id);

                  return (
                    <tr
                      key={applicant.id}
                      className={`border-b border-theme-surface-border hover:bg-theme-surface-secondary transition-colors cursor-pointer ${
                        isSelected ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => toggleOne(applicant.id)}
                          className="text-theme-text-muted hover:text-theme-text-primary"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-red-700 dark:text-red-400" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td
                        className="p-3"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-bold text-theme-text-primary flex-shrink-0">
                            {getInitials(applicant.first_name, applicant.last_name)}
                          </div>
                          <span className="text-sm font-medium text-theme-text-primary">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td
                        className="p-3 text-sm text-theme-text-muted"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.email}
                      </td>
                      <td
                        className="p-3 text-sm text-theme-text-secondary"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.current_stage_name ?? '—'}
                      </td>
                      <td
                        className="p-3"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        <span className={`inline-block text-xs px-2 py-0.5 rounded ${statusBadge.className}`}>
                          {statusBadge.label}
                        </span>
                      </td>
                      <td
                        className="p-3 text-sm text-theme-text-muted"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        <span className="flex items-center gap-1">
                          {applicant.days_in_stage}d
                          {applicant.inactivity_alert_level === 'critical' && (
                            <AlertTriangle className="w-3 h-3 text-red-700 dark:text-red-400" aria-label="Approaching timeout" />
                          )}
                          {applicant.inactivity_alert_level === 'warning' && (
                            <AlertTriangle className="w-3 h-3 text-amber-700 dark:text-amber-400" aria-label="Activity slowing" />
                          )}
                        </span>
                      </td>
                      <td
                        className="p-3 text-sm text-theme-text-muted capitalize"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.target_membership_type}
                      </td>
                      <td
                        className="p-3 text-sm text-theme-text-muted"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {formatDate(applicant.created_at, tz)}
                      </td>
                      <td className="p-3 relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() =>
                            setActionMenuId(
                              actionMenuId === applicant.id ? null : applicant.id
                            )
                          }
                          className="p-1 text-theme-text-muted hover:text-theme-text-primary transition-colors"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {actionMenuId === applicant.id && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-theme-surface-hover border border-theme-surface-border rounded-lg shadow-xl z-10 py-1">
                            <button
                              onClick={() => {
                                onApplicantClick(applicant);
                                setActionMenuId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-theme-text-secondary hover:bg-theme-surface-secondary hover:text-theme-text-primary"
                            >
                              View Details
                            </button>
                            {applicant.status === 'active' && (
                              <>
                                <button
                                  onClick={() => {
                                    advanceApplicant(applicant.id);
                                    setActionMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400 hover:bg-theme-surface-secondary"
                                >
                                  Advance Stage
                                </button>
                                <button
                                  onClick={() => {
                                    holdApplicant(applicant.id);
                                    setActionMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-amber-700 dark:text-amber-400 hover:bg-theme-surface-secondary"
                                >
                                  Put on Hold
                                </button>
                                {withdrawConfirmId === applicant.id ? (
                                  <div className="px-4 py-2 space-y-2">
                                    <p className="text-xs text-theme-text-secondary">Confirm withdraw?</p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setWithdrawConfirmId(null)}
                                        className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          withdrawApplicant(applicant.id);
                                          setWithdrawConfirmId(null);
                                          setActionMenuId(null);
                                        }}
                                        disabled={isWithdrawing}
                                        className="flex items-center gap-1 text-xs text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-50"
                                      >
                                        {isWithdrawing && <Loader2 className="w-3 h-3 animate-spin" />}
                                        Confirm
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setWithdrawConfirmId(applicant.id)}
                                    className="w-full text-left px-4 py-2 text-sm text-theme-text-muted hover:bg-theme-surface-secondary"
                                  >
                                    Withdraw
                                  </button>
                                )}
                                {rejectConfirmId === applicant.id ? (
                                  <div className="px-4 py-2 space-y-2">
                                    <p className="text-xs text-red-700 dark:text-red-300">Confirm reject?</p>
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => setRejectConfirmId(null)}
                                        className="text-xs text-theme-text-muted hover:text-theme-text-primary"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={() => {
                                          rejectApplicant(applicant.id);
                                          setRejectConfirmId(null);
                                          setActionMenuId(null);
                                        }}
                                        disabled={isRejecting}
                                        className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50"
                                      >
                                        {isRejecting && <Loader2 className="w-3 h-3 animate-spin" />}
                                        Confirm
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setRejectConfirmId(applicant.id)}
                                    className="w-full text-left px-4 py-2 text-sm text-red-700 dark:text-red-400 hover:bg-theme-surface-secondary"
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
          <div className="flex items-center justify-between p-3 border-t border-theme-surface-border">
            <p className="text-sm text-theme-text-muted">
              Page {currentPage} of {totalPages} ({totalApplicants} total)
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {getPageNumbers().map((p) => (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`w-8 h-8 text-sm rounded ${
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
                className="p-1.5 text-theme-text-muted hover:text-theme-text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
