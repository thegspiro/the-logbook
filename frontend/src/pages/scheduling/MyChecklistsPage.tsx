import React, { useState, useEffect, useCallback, Suspense } from 'react';
import {
  ClipboardCheck,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Search,
  ChevronDown,
  ChevronUp,
  Loader2,
  Truck,
  Calendar,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type {
  ShiftEquipmentCheckRecord,
  EquipmentCheckTemplate,
} from '../../modules/scheduling/types/equipmentCheck';
import { formatDate, formatTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const EquipmentCheckForm = lazyWithRetry(() => import('./EquipmentCheckForm'));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActiveChecklist {
  shiftId: string;
  shiftDate: string;
  apparatusName: string;
  templateId: string;
  templateName: string;
  checkTiming: string;
  status: string;
  totalItems?: number;
  completedItems?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusBadge = (status: string) => {
  switch (status) {
    case 'passed':
    case 'pass':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400" role="status">
          <CheckCircle className="h-3 w-3" aria-hidden="true" />
          Passed
        </span>
      );
    case 'failed':
    case 'fail':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400" role="status">
          <XCircle className="h-3 w-3" aria-hidden="true" />
          Failed
        </span>
      );
    case 'in_progress':
    case 'incomplete':
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" role="status">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          In Progress
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-theme-surface-secondary px-2 py-0.5 text-xs font-medium text-theme-text-secondary" role="status">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Not Started
        </span>
      );
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MyChecklistsPage: React.FC = () => {
  const timezone = useTimezone();

  // Active checklists
  const [loading, setLoading] = useState(true);
  const [activeChecklists, setActiveChecklists] = useState<ActiveChecklist[]>([]);
  const [timingFilter, setTimingFilter] = useState<'all' | 'start_of_shift' | 'end_of_shift'>('all');

  // History
  const [history, setHistory] = useState<ShiftEquipmentCheckRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [activeTemplate, setActiveTemplate] = useState<EquipmentCheckTemplate | null>(null);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);

  // Selected history detail
  const [selectedCheck, setSelectedCheck] = useState<ShiftEquipmentCheckRecord | null>(null);

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchActiveChecklists = useCallback(async () => {
    setLoading(true);
    try {
      const data = (await schedulingService.getMyChecklists()) as ActiveChecklist[];
      setActiveChecklists(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load active checklists'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(
    async (query?: string) => {
      setHistoryLoading(true);
      try {
        const params: { start_date?: string; end_date?: string; limit?: number; offset?: number } = {
          limit: 50,
        };
        const records = await schedulingService.getMyChecklistHistory(params);
        const filtered = query
          ? records.filter(
              (r) =>
                (r.checkedByName ?? '').toLowerCase().includes(query.toLowerCase()) ||
                (r.checkTiming ?? '').toLowerCase().includes(query.toLowerCase()),
            )
          : records;
        setHistory(filtered);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load checklist history'));
      } finally {
        setHistoryLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void fetchActiveChecklists();
  }, [fetchActiveChecklists]);

  useEffect(() => {
    if (showHistory) {
      void fetchHistory(searchQuery || undefined);
    }
  }, [showHistory, fetchHistory, searchQuery]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleStartCheck = useCallback(
    async (checklist: ActiveChecklist) => {
      try {
        const template = await schedulingService.getEquipmentCheckTemplate(checklist.templateId);
        setActiveTemplate(template);
        setActiveShiftId(checklist.shiftId);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load check template'));
      }
    },
    [],
  );

  const handleComplete = useCallback(() => {
    setActiveTemplate(null);
    setActiveShiftId(null);
    toast.success('Equipment check submitted successfully');
    void fetchActiveChecklists();
    if (showHistory) {
      void fetchHistory(searchQuery || undefined);
    }
  }, [fetchActiveChecklists, fetchHistory, showHistory, searchQuery]);

  const handleBack = useCallback(() => {
    if (!window.confirm('Leave this check? Your progress is saved as a draft and will be restored when you return.')) return;
    setActiveTemplate(null);
    setActiveShiftId(null);
  }, []);

  const handleViewCheckDetail = useCallback(
    async (checkId: string) => {
      try {
        const record = await schedulingService.getEquipmentCheck(checkId);
        setSelectedCheck(record);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load check details'));
      }
    },
    [],
  );

  // ------------------------------------------------------------------
  // Render: Equipment check form
  // ------------------------------------------------------------------

  if (activeTemplate && activeShiftId) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-theme-text-muted" />
          </div>
        }
      >
        <EquipmentCheckForm
          shiftId={activeShiftId}
          template={activeTemplate}
          onComplete={handleComplete}
          onBack={handleBack}
        />
      </Suspense>
    );
  }

  // ------------------------------------------------------------------
  // Render: Check detail view
  // ------------------------------------------------------------------

  if (selectedCheck) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedCheck(null)}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
          aria-label="Back to checklists"
        >
          &larr; Back to checklists
        </button>

        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-text-primary">Check Details</h2>
            {statusBadge(selectedCheck.overallStatus)}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-theme-text-muted">Checked By</span>
              <p className="font-medium text-theme-text-primary">{selectedCheck.checkedByName ?? 'Unknown'}</p>
            </div>
            <div>
              <span className="text-theme-text-muted">Date</span>
              <p className="font-medium text-theme-text-primary">
                {selectedCheck.checkedAt ? formatDate(selectedCheck.checkedAt, timezone) : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-theme-text-muted">Timing</span>
              <p className="font-medium text-theme-text-primary">
                {selectedCheck.checkTiming === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}
              </p>
            </div>
            <div>
              <span className="text-theme-text-muted">Progress</span>
              <p className="font-medium text-theme-text-primary">
                {selectedCheck.completedItems}/{selectedCheck.totalItems} items
                {selectedCheck.failedItems > 0 && (
                  <span className="ml-1 text-red-600">({selectedCheck.failedItems} failed)</span>
                )}
              </p>
            </div>
          </div>

          {selectedCheck.notes && (
            <div className="mb-4">
              <span className="text-sm text-theme-text-muted">Notes</span>
              <p className="mt-1 text-sm text-theme-text-primary">{selectedCheck.notes}</p>
            </div>
          )}

          {selectedCheck.items.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-theme-text-primary">Items</h3>
              <div className="space-y-1">
                {selectedCheck.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded border border-theme-surface-border px-3 py-2 text-sm"
                  >
                    <div>
                      <span className="font-medium text-theme-text-primary">{item.itemName}</span>
                      <span className="ml-2 text-theme-text-muted">{item.compartmentName}</span>
                    </div>
                    {statusBadge(item.status)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Main view
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-6 w-6 text-theme-text-primary" />
        <h1 className="text-xl font-bold text-theme-text-primary">My Equipment Checklists</h1>
      </div>

      {/* ============================================================= */}
      {/* Active Checklists Section                                      */}
      {/* ============================================================= */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-theme-text-primary">Active Checklists</h2>
          {activeChecklists.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-theme-surface-border bg-theme-surface p-0.5">
              {([['all', 'All'], ['start_of_shift', 'Start'], ['end_of_shift', 'End']] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTimingFilter(value)}
                  aria-pressed={timingFilter === value}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    timingFilter === value
                      ? 'bg-blue-600 text-white'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-theme-text-muted" />
            <span className="ml-2 text-sm text-theme-text-muted">Loading checklists...</span>
          </div>
        ) : activeChecklists.length === 0 ? (
          <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-8 text-center">
            <ClipboardCheck className="mx-auto h-10 w-10 text-theme-text-muted" />
            <p className="mt-3 text-sm text-theme-text-muted">
              No active checklists. Equipment checks will appear here when you&apos;re assigned to a shift with
              configured templates.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeChecklists
              .filter((c) => timingFilter === 'all' || c.checkTiming === timingFilter)
              .map((checklist) => {
                const total = checklist.totalItems ?? 0;
                const completed = checklist.completedItems ?? 0;
                const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const isStarted = checklist.status === 'in_progress' || checklist.status === 'incomplete';

                return (
                  <div
                    key={`${checklist.shiftId}-${checklist.templateId}`}
                    className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-theme-text-muted" />
                        <span className="text-sm font-medium text-theme-text-primary">
                          {checklist.apparatusName}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          checklist.checkTiming === 'start_of_shift'
                            ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20'
                        }`}
                      >
                        {checklist.checkTiming === 'start_of_shift' ? 'Start' : 'End'}
                      </span>
                    </div>

                    <div className="mb-1 flex items-center gap-1.5 text-xs text-theme-text-muted">
                      <Calendar className="h-3 w-3" />
                      <span>{formatDate(checklist.shiftDate, timezone)}</span>
                    </div>

                    <p className="text-sm font-medium text-theme-text-primary">{checklist.templateName}</p>

                    {/* Progress bar and count */}
                    {total > 0 && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between text-xs text-theme-text-muted">
                          <span>{completed}/{total} items</span>
                          {isStarted && <span>{progressPct}%</span>}
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-theme-surface-border" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100} aria-label={`${completed} of ${total} items checked`}>
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              progressPct === 100 ? 'bg-green-500' : 'bg-blue-500'
                            }`}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex items-center justify-between">
                      {statusBadge(checklist.status)}
                      <button
                        onClick={() => void handleStartCheck(checklist)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                      >
                        {isStarted ? 'Continue' : 'Start Check'}
                      </button>
                    </div>
                  </div>
                );
              })}
            {activeChecklists.length > 0 &&
              activeChecklists.filter((c) => timingFilter === 'all' || c.checkTiming === timingFilter).length === 0 && (
              <div className="col-span-full rounded-lg border border-theme-surface-border bg-theme-surface p-6 text-center">
                <p className="text-sm text-theme-text-muted">
                  No {timingFilter === 'start_of_shift' ? 'start of shift' : 'end of shift'} checklists.
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ============================================================= */}
      {/* Check History Section                                          */}
      {/* ============================================================= */}
      <section>
        <button
          onClick={() => setShowHistory((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface px-4 py-3 text-left transition-colors hover:bg-theme-surface-hover"
          aria-expanded={showHistory}
          aria-controls="check-history-content"
        >
          <h2 className="text-base font-semibold text-theme-text-primary">Check History</h2>
          {showHistory ? (
            <ChevronUp className="h-4 w-4 text-theme-text-muted" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4 text-theme-text-muted" aria-hidden="true" />
          )}
        </button>

        {showHistory && (
          <div id="check-history-content" className="mt-3 space-y-3">
            {/* Search bar */}
            <div className="relative">
              <label htmlFor="history-search" className="sr-only">Search history</label>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-muted" aria-hidden="true" />
              <input
                id="history-search"
                type="text"
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-theme-surface-border bg-theme-surface py-2 pl-9 pr-4 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-theme-text-muted" />
                <span className="ml-2 text-sm text-theme-text-muted">Loading history...</span>
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6 text-center">
                <p className="text-sm text-theme-text-muted">No check history found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {history.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => void handleViewCheckDetail(record.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-theme-surface-border bg-theme-surface px-4 py-3 text-left transition-colors hover:bg-theme-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-theme-text-primary">
                          {record.checkedAt ? formatDate(record.checkedAt, timezone) : 'Unknown date'}
                        </span>
                        <span className="text-xs text-theme-text-muted">
                          {record.checkedAt ? formatTime(record.checkedAt, timezone) : ''}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-theme-text-muted">
                        <span>
                          {record.checkTiming === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}
                        </span>
                        {record.checkedByName && (
                          <>
                            <span>&middot;</span>
                            <span>{record.checkedByName}</span>
                          </>
                        )}
                        <span>&middot;</span>
                        <span>
                          {record.completedItems}/{record.totalItems} items
                        </span>
                      </div>
                    </div>
                    {statusBadge(record.overallStatus)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default MyChecklistsPage;
