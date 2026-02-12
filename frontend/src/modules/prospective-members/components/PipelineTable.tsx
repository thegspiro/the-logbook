/**
 * Pipeline Table View
 *
 * Table-based view for prospective members with sorting,
 * server-side pagination, and bulk actions.
 */

import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  CheckSquare,
  Square,
  Forward,
  Pause,
  XCircle,
  MoreHorizontal,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { ApplicantListItem, ApplicantStatus } from '../types';
import { useProspectiveMembersStore } from '../store/prospectiveMembersStore';

interface PipelineTableProps {
  applicants: ApplicantListItem[];
  totalApplicants: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onApplicantClick: (applicant: ApplicantListItem) => void;
}

const STATUS_BADGES: Record<ApplicantStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/20 text-emerald-400' },
  on_hold: { label: 'On Hold', className: 'bg-amber-500/20 text-amber-400' },
  withdrawn: { label: 'Withdrawn', className: 'bg-slate-500/20 text-slate-400' },
  converted: { label: 'Converted', className: 'bg-blue-500/20 text-blue-400' },
  rejected: { label: 'Rejected', className: 'bg-red-500/20 text-red-400' },
};

export const PipelineTable: React.FC<PipelineTableProps> = ({
  applicants,
  totalApplicants,
  currentPage,
  totalPages,
  onPageChange,
  onApplicantClick,
}) => {
  const { advanceApplicant, holdApplicant, rejectApplicant } =
    useProspectiveMembersStore();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);

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

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
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
        <div className="mb-3 flex items-center gap-3 p-3 bg-slate-800 border border-white/10 rounded-lg">
          <span className="text-sm text-slate-300">
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
              onClick={() => handleBulkAction('reject')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="w-10 p-3">
                  <button onClick={toggleAll} className="text-slate-400 hover:text-white">
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-red-400" />
                    ) : someSelected ? (
                      <CheckSquare className="w-4 h-4 text-red-400/50" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-white">
                    Name <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-white">
                    Current Stage <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-white">
                    Days in Stage <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  Target Type
                </th>
                <th className="text-left p-3 text-xs font-medium text-slate-400 uppercase tracking-wider">
                  <div className="flex items-center gap-1 cursor-pointer hover:text-white">
                    Applied <ArrowUpDown className="w-3 h-3" />
                  </div>
                </th>
                <th className="w-12 p-3"></th>
              </tr>
            </thead>
            <tbody>
              {applicants.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-400">
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
                      className={`border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${
                        isSelected ? 'bg-red-500/5' : ''
                      }`}
                    >
                      <td className="p-3" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => toggleOne(applicant.id)}
                          className="text-slate-400 hover:text-white"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-red-400" />
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
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-red-700 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                            {applicant.first_name[0]}{applicant.last_name[0]}
                          </div>
                          <span className="text-sm font-medium text-white">
                            {applicant.first_name} {applicant.last_name}
                          </span>
                        </div>
                      </td>
                      <td
                        className="p-3 text-sm text-slate-400"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.email}
                      </td>
                      <td
                        className="p-3 text-sm text-slate-300"
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
                        className="p-3 text-sm text-slate-400"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.days_in_stage}d
                      </td>
                      <td
                        className="p-3 text-sm text-slate-400 capitalize"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {applicant.target_membership_type}
                      </td>
                      <td
                        className="p-3 text-sm text-slate-400"
                        onClick={() => onApplicantClick(applicant)}
                      >
                        {formatDate(applicant.created_at)}
                      </td>
                      <td className="p-3 relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() =>
                            setActionMenuId(
                              actionMenuId === applicant.id ? null : applicant.id
                            )
                          }
                          className="p-1 text-slate-400 hover:text-white transition-colors"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                        {actionMenuId === applicant.id && (
                          <div className="absolute right-0 top-full mt-1 w-40 bg-slate-700 border border-white/10 rounded-lg shadow-xl z-10 py-1">
                            <button
                              onClick={() => {
                                onApplicantClick(applicant);
                                setActionMenuId(null);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
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
                                  className="w-full text-left px-4 py-2 text-sm text-emerald-400 hover:bg-white/5"
                                >
                                  Advance Stage
                                </button>
                                <button
                                  onClick={() => {
                                    holdApplicant(applicant.id);
                                    setActionMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-amber-400 hover:bg-white/5"
                                >
                                  Put on Hold
                                </button>
                                <button
                                  onClick={() => {
                                    rejectApplicant(applicant.id);
                                    setActionMenuId(null);
                                  }}
                                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-white/5"
                                >
                                  Reject
                                </button>
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
          <div className="flex items-center justify-between p-3 border-t border-white/10">
            <p className="text-sm text-slate-400">
              Page {currentPage} of {totalPages} ({totalApplicants} total)
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
                      : 'text-slate-400 hover:bg-white/10 hover:text-white'
                  } transition-colors`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
