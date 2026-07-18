/**
 * Member Training Status — month-at-a-glance roster (Records → Monthly Status).
 *
 * For a selected period (a month, or a custom date range) shows every active
 * member's training activity in that window (completions, hours, last activity)
 * alongside their current compliance standing, so a training officer can see
 * how everyone is doing at a glance.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Users } from 'lucide-react';
import toast from 'react-hot-toast';

import { trainingService } from '../services/trainingServices';
import type {
  MemberComplianceStatusColor,
  MemberPeriodStatusRow,
} from '../types/training';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, getTodayLocalDate } from '../utils/dateFormatting';
import { SkeletonCard } from '../components/ux/Skeleton';
import { EmptyState } from '../components/ux/EmptyState';
import {
  SortableHeader,
  type SortDirection,
} from '../components/ux/SortableHeader';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

type Mode = 'month' | 'range';

const STATUS_META: Record<
  MemberComplianceStatusColor,
  { label: string; cls: string }
> = {
  green: {
    label: 'Compliant',
    cls: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30',
  },
  yellow: {
    label: 'At Risk',
    cls: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30',
  },
  red: {
    label: 'Behind',
    cls: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  },
  exempt: {
    label: 'Exempt',
    cls: 'bg-theme-surface-hover text-theme-text-muted border-theme-surface-border',
  },
};

const MemberTrainingStatusPage: React.FC = () => {
  const tz = useTimezone();

  // Default to the current month.
  const todayIso = getTodayLocalDate(tz);
  const [ty, tmRaw] = todayIso.split('-');
  const initialYear = Number(ty) || new Date().getFullYear();
  const initialMonth = Number(tmRaw) || 1; // 1-based

  const [mode, setMode] = useState<Mode>('month');
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth); // 1-based
  const [rangeStart, setRangeStart] = useState(isoDate(initialYear, initialMonth, 1));
  const [rangeEnd, setRangeEnd] = useState(
    isoDate(initialYear, initialMonth, lastDayOfMonth(initialYear, initialMonth)),
  );

  const [rows, setRows] = useState<MemberPeriodStatusRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<string | null>('member_name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const { startDate, endDate } = useMemo(() => {
    if (mode === 'month') {
      return {
        startDate: isoDate(year, month, 1),
        endDate: isoDate(year, month, lastDayOfMonth(year, month)),
      };
    }
    return { startDate: rangeStart, endDate: rangeEnd };
  }, [mode, year, month, rangeStart, rangeEnd]);

  const load = useCallback(async () => {
    if (endDate < startDate) {
      toast.error('End date must be on or after the start date');
      return;
    }
    setLoading(true);
    try {
      const data = await trainingService.getMemberPeriodStatus(startDate, endDate);
      setRows(data.members);
    } catch {
      toast.error('Failed to load member training status');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const handleSort = (field: string, direction: SortDirection) => {
    setSortField(direction ? field : null);
    setSortDir(direction);
  };

  const sortedRows = useMemo(() => {
    if (!sortField || !sortDir) return rows;
    const dir = sortDir === 'asc' ? 1 : -1;
    const statusRank: Record<string, number> = { red: 0, yellow: 1, green: 2, exempt: 3 };
    return [...rows].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      switch (sortField) {
        case 'trainings_completed':
          av = a.trainings_completed; bv = b.trainings_completed; break;
        case 'hours_completed':
          av = a.hours_completed; bv = b.hours_completed; break;
        case 'last_activity':
          av = a.last_activity ?? ''; bv = b.last_activity ?? ''; break;
        case 'compliance_status':
          av = statusRank[a.compliance_status] ?? 9;
          bv = statusRank[b.compliance_status] ?? 9;
          break;
        default:
          av = a.member_name.toLowerCase(); bv = b.member_name.toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sortField, sortDir]);

  const summary = useMemo(() => {
    const totalHours = rows.reduce((s, r) => s + r.hours_completed, 0);
    const activeMembers = rows.filter((r) => r.trainings_completed > 0).length;
    const behind = rows.filter((r) => r.compliance_status === 'red').length;
    return { totalHours, activeMembers, behind, totalMembers: rows.length };
  }, [rows]);

  const exportCsv = () => {
    const header = [
      'Member', 'Trainings Completed', 'Hours', 'Last Activity',
      'Compliance Status', 'Requirements Met', 'Requirements Total',
    ];
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = sortedRows.map((r) =>
      [
        escape(r.member_name),
        r.trainings_completed,
        r.hours_completed,
        r.last_activity ? formatDate(r.last_activity, tz) : '',
        STATUS_META[r.compliance_status].label,
        r.requirements_met,
        r.requirements_total,
      ].join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-status_${startDate}_to_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Controls */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-theme-surface-border overflow-hidden">
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1.5 text-sm ${mode === 'month' ? 'bg-red-600/20 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              Month
            </button>
            <button
              onClick={() => setMode('range')}
              className={`px-3 py-1.5 text-sm ${mode === 'range' ? 'bg-red-600/20 text-red-700 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'}`}
            >
              Custom range
            </button>
          </div>

          {mode === 'month' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="btn-icon"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <span className="min-w-[9rem] text-center text-sm font-semibold text-theme-text-primary">
                {MONTHS[month - 1]} {year}
              </span>
              <button
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="btn-icon"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={rangeStart}
                max={rangeEnd || undefined}
                onChange={(e) => setRangeStart(e.target.value)}
                aria-label="Start date"
                className="form-input"
              />
              <span className="text-theme-text-muted">to</span>
              <input
                type="date"
                value={rangeEnd}
                min={rangeStart || undefined}
                onChange={(e) => setRangeEnd(e.target.value)}
                aria-label="End date"
                className="form-input"
              />
            </div>
          )}
        </div>

        <button
          onClick={exportCsv}
          disabled={loading || rows.length === 0}
          className="btn-primary inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Summary tiles */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Members', value: summary.totalMembers },
          { label: 'Trained this period', value: summary.activeMembers },
          { label: 'Hours logged', value: summary.totalHours.toFixed(1) },
          { label: 'Behind on requirements', value: summary.behind },
        ].map((t) => (
          <div key={t.label} className="card">
            <p className="text-2xl font-bold text-theme-text-primary">{t.value}</p>
            <p className="text-xs text-theme-text-muted">{t.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <SkeletonCard />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No members to show"
          description="No active members were found for this period."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-theme-surface-border">
          <table className="min-w-full text-sm">
            <thead className="bg-theme-surface-secondary">
              <tr>
                <SortableHeader label="Member" field="member_name" currentSort={sortField} currentDirection={sortDir} onSort={handleSort} className="px-4 py-2 text-left" />
                <SortableHeader label="Trainings" field="trainings_completed" currentSort={sortField} currentDirection={sortDir} onSort={handleSort} className="px-4 py-2 text-left" />
                <SortableHeader label="Hours" field="hours_completed" currentSort={sortField} currentDirection={sortDir} onSort={handleSort} className="px-4 py-2 text-left" />
                <SortableHeader label="Last activity" field="last_activity" currentSort={sortField} currentDirection={sortDir} onSort={handleSort} className="px-4 py-2 text-left" />
                <SortableHeader label="Status" field="compliance_status" currentSort={sortField} currentDirection={sortDir} onSort={handleSort} className="px-4 py-2 text-left" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => {
                const meta = STATUS_META[r.compliance_status];
                return (
                  <tr key={r.user_id} className="border-t border-theme-surface-border">
                    <td className="px-4 py-2 font-medium text-theme-text-primary">{r.member_name}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{r.trainings_completed}</td>
                    <td className="px-4 py-2 text-theme-text-secondary">{r.hours_completed.toFixed(1)}</td>
                    <td className="px-4 py-2 text-theme-text-muted">
                      {r.last_activity ? formatDate(r.last_activity, tz) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                        {r.compliance_status !== 'exempt' && (
                          <span className="text-xs text-theme-text-muted">
                            {r.requirements_met}/{r.requirements_total} met
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MemberTrainingStatusPage;
