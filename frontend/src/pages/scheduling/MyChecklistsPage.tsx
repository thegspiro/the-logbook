import React, { useState, useEffect, useCallback, useMemo, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  ClipboardCheck,
  CheckCircle,
  XCircle,
  AlertCircle,
  Clock,
  Search,
  ChevronDown,
  ChevronUp,
  Settings,
  Loader2,
  Truck,
  Calendar,
  Play,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { ShiftEquipmentCheckRecord, EquipmentCheckTemplate } from '../../modules/scheduling/types/equipmentCheck';
import type { ActiveChecklistRecord } from '../../modules/scheduling/services/api';
import { formatDate, formatTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { useAuthStore } from '../../stores/authStore';
import { lazyWithRetry } from '../../utils/lazyWithRetry';

const EquipmentCheckForm = lazyWithRetry(() => import('./EquipmentCheckForm'));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActiveChecklist = ActiveChecklistRecord;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusBadge = (status: string) => {
  switch (status) {
    case 'passed':
    case 'pass':
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
          role="status"
          aria-live="polite"
        >
          <CheckCircle className="h-3 w-3" aria-hidden="true" />
          Passed
        </span>
      );
    case 'failed':
    case 'fail':
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
          role="status"
          aria-live="polite"
        >
          <XCircle className="h-3 w-3" aria-hidden="true" />
          Failed
        </span>
      );
    case 'in_progress':
    case 'incomplete':
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
          role="status"
          aria-live="polite"
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          In Progress
        </span>
      );
    default:
      return (
        <span
          className="bg-theme-surface-secondary text-theme-text-secondary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          role="status"
          aria-live="polite"
        >
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
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('scheduling.manage') || checkPermission('equipment_check.manage');

  const [searchParams] = useSearchParams();
  const highlightShiftId = searchParams.get('shift') || undefined;

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
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null);

  // Standalone check template picker
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [availableTemplates, setAvailableTemplates] = useState<EquipmentCheckTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);

  // Selected history detail
  const [selectedCheck, setSelectedCheck] = useState<ShiftEquipmentCheckRecord | null>(null);

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchActiveChecklists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await schedulingService.getMyChecklists();
      setActiveChecklists(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load active checklists'));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params: { start_date?: string; end_date?: string; limit?: number; offset?: number } = {
        limit: 50,
      };
      const records = await schedulingService.getMyChecklistHistory(params);
      setHistory(records);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load checklist history'));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchActiveChecklists();
  }, [fetchActiveChecklists]);

  // History is filtered client-side, so it is fetched once when the panel
  // opens — not on every keystroke in the search box.
  useEffect(() => {
    if (showHistory) {
      void fetchHistory();
    }
  }, [showHistory, fetchHistory]);

  const displayedHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return history;
    return history.filter(
      (r) => (r.checkedByName ?? '').toLowerCase().includes(q) || (r.checkTiming ?? '').toLowerCase().includes(q)
    );
  }, [history, searchQuery]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  const handleStartCheck = useCallback(async (checklist: ActiveChecklist) => {
    try {
      const template = await schedulingService.getEquipmentCheckTemplate(checklist.templateId);
      setActiveTemplate(template);
      setActiveShiftId(checklist.shiftId);
      setActiveCheckId(checklist.checkId || null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check template'));
    }
  }, []);

  const handleComplete = useCallback(() => {
    setActiveTemplate(null);
    setActiveShiftId(null);
    setActiveCheckId(null);
    toast.success('Equipment check submitted successfully');
    void fetchActiveChecklists();
    if (showHistory) {
      void fetchHistory();
    }
  }, [fetchActiveChecklists, fetchHistory, showHistory]);

  const handleBack = useCallback(() => {
    if (!window.confirm('Leave this check? Your progress is saved as a draft and will be restored when you return.'))
      return;
    setActiveTemplate(null);
    setActiveShiftId(null);
    setActiveCheckId(null);
  }, []);

  const handleOpenTemplatePicker = useCallback(async () => {
    setShowTemplatePicker(true);
    setTemplatesLoading(true);
    try {
      const templates = await schedulingService.getEquipmentCheckTemplates();
      setAvailableTemplates(templates.filter((t) => t.isActive));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load templates'));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const handleStartStandaloneCheck = useCallback(async (templateId: string) => {
    try {
      const template = await schedulingService.getEquipmentCheckTemplate(templateId);
      setActiveTemplate(template);
      setActiveShiftId(null);
      setShowTemplatePicker(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check template'));
    }
  }, []);

  const handleViewCheckDetail = useCallback(async (checkId: string) => {
    try {
      const record = await schedulingService.getEquipmentCheck(checkId);
      setSelectedCheck(record);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check details'));
    }
  }, []);

  const handleResumeCheck = useCallback(async (check: ShiftEquipmentCheckRecord) => {
    if (!check.templateId) {
      toast.error('Cannot resume: no template associated with this check');
      return;
    }
    try {
      const template = await schedulingService.getEquipmentCheckTemplate(check.templateId);
      setActiveTemplate(template);
      setActiveShiftId(check.shiftId || null);
      setActiveCheckId(check.id);
      setSelectedCheck(null);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check template'));
    }
  }, []);

  // ------------------------------------------------------------------
  // Render: Equipment check form
  // ------------------------------------------------------------------

  if (activeTemplate) {
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
          </div>
        }
      >
        <EquipmentCheckForm
          shiftId={activeShiftId || undefined}
          template={activeTemplate}
          onComplete={handleComplete}
          onBack={handleBack}
          existingCheckId={activeCheckId || undefined}
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

        <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-theme-text-primary text-lg font-semibold">Check Details</h2>
            {statusBadge(selectedCheck.overallStatus)}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <span className="text-theme-text-muted">Checked By</span>
              <p className="text-theme-text-primary font-medium">{selectedCheck.checkedByName ?? 'Unknown'}</p>
            </div>
            <div>
              <span className="text-theme-text-muted">Date</span>
              <p className="text-theme-text-primary font-medium">
                {selectedCheck.checkedAt ? formatDate(selectedCheck.checkedAt, timezone) : 'N/A'}
              </p>
            </div>
            <div>
              <span className="text-theme-text-muted">Timing</span>
              <p className="text-theme-text-primary font-medium">
                {selectedCheck.checkTiming === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}
              </p>
            </div>
            <div>
              <span className="text-theme-text-muted">Progress</span>
              <p className="text-theme-text-primary font-medium">
                {selectedCheck.completedItems}/{selectedCheck.totalItems} items
                {selectedCheck.failedItems > 0 && (
                  <span className="ml-1 text-red-600">({selectedCheck.failedItems} failed)</span>
                )}
              </p>
            </div>
          </div>

          {selectedCheck.notes && (
            <div className="mb-4">
              <span className="text-theme-text-muted text-sm">Notes</span>
              <p className="text-theme-text-primary mt-1 text-sm">{selectedCheck.notes}</p>
            </div>
          )}

          {selectedCheck.items.length > 0 && (
            <div>
              <h3 className="text-theme-text-primary mb-2 text-sm font-medium">Items</h3>
              <div className="space-y-1">
                {selectedCheck.items.map((item) => (
                  <div
                    key={item.id}
                    className="border-theme-surface-border flex flex-col gap-1 rounded border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                  >
                    <div className="min-w-0">
                      <span className="text-theme-text-primary font-medium">{item.itemName}</span>
                      <span className="text-theme-text-muted ml-2">{item.compartmentName}</span>
                    </div>
                    {statusBadge(item.status)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {selectedCheck.overallStatus === 'incomplete' && (
            <div className="border-theme-surface-border mt-4 border-t pt-4">
              <button
                onClick={() => void handleResumeCheck(selectedCheck)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Play className="h-4 w-4" />
                Resume Check
              </button>
              <p className="text-theme-text-muted mt-2 text-center text-xs">
                {selectedCheck.completedItems}/{selectedCheck.totalItems} items completed — pick up where you left off.
              </p>
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="text-theme-text-primary h-6 w-6" />
          <h1 className="text-theme-text-primary text-xl font-bold">My Equipment Checklists</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleOpenTemplatePicker()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            <Play className="h-3.5 w-3.5" />
            Start a Check
          </button>
          {canManage && (
            <Link
              to="/scheduling/settings?tab=equipment"
              className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              Manage Templates
            </Link>
          )}
        </div>
      </div>

      {/* ============================================================= */}
      {/* Active Checklists Section                                      */}
      {/* ============================================================= */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-theme-text-primary text-base font-semibold">Active Checklists</h2>
          {activeChecklists.length > 1 && (
            <div className="border-theme-surface-border bg-theme-surface flex items-center gap-1 rounded-lg border p-0.5">
              {(
                [
                  ['all', 'All'],
                  ['start_of_shift', 'Start'],
                  ['end_of_shift', 'End'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setTimingFilter(value)}
                  aria-pressed={timingFilter === value}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:px-2.5 sm:py-1 ${
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
          <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
            <span className="text-theme-text-muted ml-2 text-sm">Loading checklists...</span>
          </div>
        ) : activeChecklists.length === 0 ? (
          <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-8 text-center">
            <ClipboardCheck className="text-theme-text-muted mx-auto h-10 w-10" />
            <p className="text-theme-text-muted mt-3 text-sm">
              No active checklists. Equipment checks will appear here when you&apos;re assigned to a shift with
              configured templates.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activeChecklists
              .filter((c) => timingFilter === 'all' || c.checkTiming === timingFilter)
              .slice()
              .sort((a, b) => {
                if (!highlightShiftId) return 0;
                const aMatch = a.shiftId === highlightShiftId ? 0 : 1;
                const bMatch = b.shiftId === highlightShiftId ? 0 : 1;
                return aMatch - bMatch;
              })
              .map((checklist) => {
                const total = checklist.totalItems ?? 0;
                const completed = checklist.completedItems ?? 0;
                const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
                const isStarted = checklist.status === 'in_progress' || checklist.status === 'incomplete';
                const isHighlighted = highlightShiftId === checklist.shiftId;

                return (
                  <div
                    key={`${checklist.shiftId}-${checklist.templateId}`}
                    className={`rounded-lg border p-4 ${
                      isHighlighted
                        ? 'border-blue-500 bg-blue-50/50 ring-2 ring-blue-500/20 dark:bg-blue-950/20'
                        : 'border-theme-surface-border bg-theme-surface'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Truck className="text-theme-text-muted h-4 w-4" />
                        <span className="text-theme-text-primary text-sm font-medium">{checklist.apparatusName}</span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          checklist.checkTiming === 'start_of_shift'
                            ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                            : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {checklist.checkTiming === 'start_of_shift' ? 'Start' : 'End'}
                      </span>
                    </div>

                    <div className="text-theme-text-muted mb-1 flex items-center gap-1.5 text-xs">
                      <Calendar className="h-3 w-3" />
                      <span>{formatDate(checklist.shiftDate, timezone)}</span>
                    </div>

                    <p className="text-theme-text-primary text-sm font-medium">{checklist.templateName}</p>

                    {/* Progress bar and count */}
                    {total > 0 && (
                      <div className="mt-2">
                        <div className="text-theme-text-muted mb-1 flex items-center justify-between text-xs">
                          <span>
                            {completed}/{total} items
                          </span>
                          {isStarted && <span>{progressPct}%</span>}
                        </div>
                        <div
                          className="bg-theme-surface-border h-1.5 w-full overflow-hidden rounded-full"
                          role="progressbar"
                          aria-valuenow={progressPct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${completed} of ${total} items checked`}
                        >
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
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        {isStarted ? 'Continue' : 'Start Check'}
                      </button>
                    </div>
                  </div>
                );
              })}
            {activeChecklists.length > 0 &&
              activeChecklists.filter((c) => timingFilter === 'all' || c.checkTiming === timingFilter).length === 0 && (
                <div className="border-theme-surface-border bg-theme-surface col-span-full rounded-lg border p-6 text-center">
                  <p className="text-theme-text-muted text-sm">
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
          className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors"
          aria-expanded={showHistory}
          aria-controls="check-history-content"
        >
          <h2 className="text-theme-text-primary text-base font-semibold">Check History</h2>
          {showHistory ? (
            <ChevronUp className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          )}
        </button>

        {showHistory && (
          <div id="check-history-content" className="mt-3 space-y-3">
            {/* Search bar */}
            <div className="relative">
              <label htmlFor="history-search" className="sr-only">
                Search history
              </label>
              <Search
                className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                id="history-search"
                type="text"
                aria-label="Search history..."
                placeholder="Search history..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="border-theme-surface-border bg-theme-surface text-theme-text-primary placeholder:text-theme-text-muted w-full rounded-lg border py-2 pr-4 pl-9 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
                <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
                <span className="text-theme-text-muted ml-2 text-sm">Loading history...</span>
              </div>
            ) : displayedHistory.length === 0 ? (
              <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-6 text-center">
                <p className="text-theme-text-muted text-sm">No check history found.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {displayedHistory.map((record) => (
                  <button
                    key={record.id}
                    onClick={() => void handleViewCheckDetail(record.id)}
                    className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover flex w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-theme-text-primary text-sm font-medium">
                          {record.checkedAt ? formatDate(record.checkedAt, timezone) : 'Unknown date'}
                        </span>
                        <span className="text-theme-text-muted text-xs">
                          {record.checkedAt ? formatTime(record.checkedAt, timezone) : ''}
                        </span>
                      </div>
                      <div className="text-theme-text-muted mt-0.5 flex items-center gap-2 text-xs">
                        <span>{record.checkTiming === 'start_of_shift' ? 'Start of Shift' : 'End of Shift'}</span>
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

      {/* Template Picker Modal */}
      {showTemplatePicker && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="Select a checklist template"
        >
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => setShowTemplatePicker(false)}
              aria-hidden="true"
            />
            <div className="border-theme-surface-border bg-theme-surface relative w-full max-w-md rounded-xl border shadow-xl">
              <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-theme-text-primary text-base font-semibold">Select a Checklist</h2>
                <button
                  onClick={() => setShowTemplatePicker(false)}
                  className="text-theme-text-muted hover:bg-theme-surface-hover rounded-lg p-1 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="p-4">
                {templatesLoading ? (
                  <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
                    <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
                    <span className="text-theme-text-muted ml-2 text-sm">Loading templates...</span>
                  </div>
                ) : availableTemplates.length === 0 ? (
                  <div className="py-8 text-center">
                    <ClipboardCheck className="text-theme-text-muted mx-auto h-10 w-10" />
                    <p className="text-theme-text-muted mt-3 text-sm">No active check templates available.</p>
                    {canManage && (
                      <Link
                        to="/scheduling/settings?tab=equipment"
                        className="mt-2 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
                        onClick={() => setShowTemplatePicker(false)}
                      >
                        Create a template
                      </Link>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => void handleStartStandaloneCheck(tmpl.id)}
                        className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover group flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                          <ClipboardCheck className="h-4 w-4 text-blue-600" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-theme-text-primary truncate text-sm font-medium">{tmpl.name}</p>
                          <div className="text-theme-text-muted flex items-center gap-2 text-xs">
                            {tmpl.apparatusType && (
                              <span className="flex items-center gap-1">
                                <Truck className="h-3 w-3" />
                                {tmpl.apparatusType}
                              </span>
                            )}
                            <span>
                              {tmpl.compartments?.reduce((sum, c) => sum + (c.items?.length ?? 0), 0) ?? 0} items
                            </span>
                            <span
                              className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                tmpl.checkTiming === 'start_of_shift'
                                  ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400'
                                  : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {tmpl.checkTiming === 'start_of_shift' ? 'Start' : 'End'}
                            </span>
                          </div>
                        </div>
                        <Play className="text-theme-text-muted h-4 w-4 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MyChecklistsPage;
