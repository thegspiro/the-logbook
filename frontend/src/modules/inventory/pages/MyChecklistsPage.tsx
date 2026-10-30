import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router';
import { DialogPanel } from '@/components/ux/DialogPanel';
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
  MinusCircle,
  MoreHorizontal,
  Truck,
  Boxes,
  Play,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  ShiftEquipmentCheckRecord,
  EquipmentCheckTemplate,
} from '../../../modules/inventory/types/equipmentCheck';
import { describeCount, isChecklistSubmitted } from '../../../modules/inventory/types/equipmentCheck';
import type { ActiveChecklistRecord } from '../services/equipmentCheckApi';
import { calendarDaysFromToday, formatDate, formatTime, toLocalISODate } from '../../../utils/dateFormatting';
import { dayHeading } from '../utils/dayHeading';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useAuthStore } from '../../../stores/authStore';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import { crewVisibleTemplates } from './equipmentCheckTemplates';

import { useConfirm } from '../../../contexts/ConfirmContext';
import { useOverlaySurface } from '../../../hooks/useOverlaySurface';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';
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
    case 'out_of_service':
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"
          role="status"
          aria-live="polite"
        >
          <XCircle className="h-3 w-3" aria-hidden="true" />
          {status === 'out_of_service' ? 'Out of service' : 'Failed'}
        </span>
      );
    case 'not_applicable':
      return (
        <span
          className="bg-theme-surface-hover text-theme-text-muted inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
          role="status"
          aria-live="polite"
        >
          <MinusCircle className="h-3 w-3" aria-hidden="true" />
          Not on truck
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

const TIMING_LABELS: Record<string, string> = {
  start_of_shift: 'Start of shift',
  end_of_shift: 'End of shift',
};

const TIMING_SHORT: Record<string, string> = {
  start_of_shift: 'Start',
  end_of_shift: 'End',
};

const timingBadgeClass = (timing: string | undefined) =>
  timing === 'start_of_shift'
    ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400'
    : 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-400';

const DAY_HEADING_CLASS =
  'bg-theme-bg text-theme-text-primary mobile-header-inset sticky z-10 flex items-baseline gap-2 py-1.5 text-sm font-semibold md:top-0';

/** Consecutive runs of one key, in the order given — the lists arrive sorted. */
function groupRuns<T>(items: T[], keyOf: (item: T) => string): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = keyOf(item);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MyChecklistsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const timezone = useTimezone();
  const { checkPermission } = useAuthStore();
  // The links this gates all open the checklist admin console, whose route
  // requires `inventory.check_manage`. It used to accept `scheduling.manage`
  // too, from when they pointed at a signpost card inside Scheduling Settings —
  // which meant a checklist officer holding only the check grant was shown a
  // link that refused them, and now would mean a scheduling officer without it
  // is. A control is offered to whoever its destination admits, and nobody else.
  const canManage = checkPermission('inventory.check_manage');

  const [searchParams] = useSearchParams();
  const highlightShiftId = searchParams.get('shift') || undefined;

  // Active checklists
  const [loading, setLoading] = useState(true);
  const [activeChecklists, setActiveChecklists] = useState<ActiveChecklist[]>([]);

  // History
  const [history, setHistory] = useState<ShiftEquipmentCheckRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [activeTemplate, setActiveTemplate] = useState<EquipmentCheckTemplate | null>(null);
  const [activeShiftId, setActiveShiftId] = useState<string | null>(null);
  const [activeCheckId, setActiveCheckId] = useState<string | null>(null);
  const [activeShiftContext, setActiveShiftContext] = useState<
    { apparatusName?: string; shiftDate?: string; checkTiming?: string } | undefined
  >(undefined);

  // Standalone check template picker
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // Takes the fixed mobile bottom bar off this overlay while it is open.
  useOverlaySurface(showTemplatePicker);
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
      const data = await equipmentCheckService.getMyChecklists();
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
      const records = await equipmentCheckService.getMyChecklistHistory(params);
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

  /**
   * Due checklists by day, soonest first. Within a day the start-of-shift
   * check precedes the end-of-shift one, because that is the order they are
   * done in. A shift arrived at from the drawer (`?shift=`) still comes to the
   * top: its day leads, and within that day its rows do.
   */
  const dueDays = useMemo(() => {
    const timingRank = (t: string) => (t === 'start_of_shift' ? 0 : 1);
    const sorted = activeChecklists.slice().sort((a, b) => {
      const byDate = (a.shiftDate ?? '').localeCompare(b.shiftDate ?? '');
      if (byDate !== 0) return byDate;
      if (highlightShiftId) {
        const aMatch = a.shiftId === highlightShiftId ? 0 : 1;
        const bMatch = b.shiftId === highlightShiftId ? 0 : 1;
        if (aMatch !== bMatch) return aMatch - bMatch;
      }
      return timingRank(a.checkTiming) - timingRank(b.checkTiming);
    });
    const days = groupRuns(sorted, (c) => c.shiftDate ?? '');
    const highlighted = days.findIndex((d) => d.items.some((c) => c.shiftId === highlightShiftId));
    if (highlighted > 0) days.unshift(...days.splice(highlighted, 1));
    return days;
  }, [activeChecklists, highlightShiftId]);

  /**
   * History records carry no checklist name, so one is borrowed from the
   * member's current checklists where the template is still among them. A
   * rig name is not borrowed: one template can serve several rigs, and the
   * record does not say which it was run on.
   */
  const templateNames = useMemo(
    () => new Map(activeChecklists.map((c) => [c.templateId, c.templateName] as const)),
    [activeChecklists]
  );

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
      const template = await equipmentCheckService.getEquipmentCheckTemplate(checklist.templateId);
      setActiveTemplate(template);
      setActiveShiftId(checklist.shiftId);
      setActiveCheckId(checklist.checkId || null);
      // The open checklist keeps saying which shift it belongs to; without this
      // two trucks on one template produce the same screen.
      setActiveShiftContext({
        apparatusName: checklist.apparatusName,
        shiftDate: checklist.shiftDate,
        checkTiming: checklist.checkTiming,
      });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check template'));
    }
  }, []);

  // No toast here: the form has already said how the check ended — submitted,
  // saved offline, or queued for sync — and only it knows which. A second
  // "submitted" from the page doubled the online message and contradicted the
  // offline one.
  const handleComplete = useCallback(() => {
    setActiveTemplate(null);
    setActiveShiftId(null);
    setActiveCheckId(null);
    setActiveShiftContext(undefined);
    void fetchActiveChecklists();
    if (showHistory) {
      void fetchHistory();
    }
  }, [fetchActiveChecklists, fetchHistory, showHistory]);

  const handleBack = useCallback(async () => {
    if (
      !(await confirm({
        title: 'Leave this check?',
        message: 'Your progress is saved as a draft and will be waiting for you when you come back to it.',
        confirmLabel: 'Leave',
        cancelLabel: 'Stay here',
        variant: 'info',
      }))
    )
      return;
    setActiveTemplate(null);
    setActiveShiftId(null);
    setActiveCheckId(null);
    setActiveShiftContext(undefined);
  }, [confirm]);

  const handleOpenTemplatePicker = useCallback(async () => {
    setShowTemplatePicker(true);
    setTemplatesLoading(true);
    try {
      const templates = await equipmentCheckService.getEquipmentCheckTemplates();
      setAvailableTemplates(crewVisibleTemplates(templates));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load templates'));
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const handleStartStandaloneCheck = useCallback(async (templateId: string) => {
    try {
      const template = await equipmentCheckService.getEquipmentCheckTemplate(templateId);
      setActiveTemplate(template);
      setActiveShiftId(null);
      setShowTemplatePicker(false);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load check template'));
    }
  }, []);

  const handleViewCheckDetail = useCallback(async (checkId: string) => {
    try {
      const record = await equipmentCheckService.getEquipmentCheck(checkId);
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
      const template = await equipmentCheckService.getEquipmentCheckTemplate(check.templateId);
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
          onBack={() => void handleBack()}
          existingCheckId={activeCheckId || undefined}
          shiftContext={activeShiftContext}
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

        <div className="card p-4 sm:p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-theme-text-primary text-lg font-semibold">Completed checklist</h2>
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
                    className="split-row border-theme-surface-border gap-1 rounded border px-3 py-2 text-sm sm:items-center sm:gap-2"
                  >
                    <div className="split-row-main">
                      <span className="text-theme-text-primary font-medium">{item.itemName}</span>
                      <span className="text-theme-text-muted ml-2">{item.compartmentName || 'On the checklist'}</span>
                      {item.quantityFound != null && (
                        <span className="text-theme-text-secondary block text-xs">
                          {/* Results filed before par was snapshotted carry
                              only the single target they were judged by. */}
                          {describeCount(
                            item.quantityFound,
                            item.expectedQuantity ?? item.requiredQuantity,
                            item.countUnit
                          )}
                        </span>
                      )}
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
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-900"
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
    <div className="mx-auto max-w-7xl space-y-6">
      {/* On a phone the two links that lead elsewhere fold into a menu, so
          the list starts on the first screen. */}
      <OperationsPageHeader
        icon={ClipboardCheck}
        title="My Equipment Checklists"
        actions={
          <>
            <button
              onClick={() => void handleOpenTemplatePicker()}
              className="btn-primary inline-flex items-center gap-1.5"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              Unscheduled checklist
            </button>
            {/* A whole checklist is the wrong instrument for "we just used two of
          these". This is the way to record that without starting one. */}
            <Link
              to="/inventory/checklists/apparatus-inventory"
              className="btn-secondary hidden items-center gap-1.5 sm:inline-flex"
            >
              <Boxes className="h-4 w-4" aria-hidden="true" />
              Apparatus Inventory
            </Link>
            {canManage && (
              <Link
                to="/inventory/admin/checklists"
                className="btn-secondary hidden items-center gap-1.5 sm:inline-flex"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Manage Templates
              </Link>
            )}
            <HeaderMenu canManage={canManage} />
          </>
        }
      />

      {/* ============================================================= */}
      {/* Checklists due now and coming up, by day                       */}
      {/* ============================================================= */}
      <section aria-labelledby="due-heading">
        <h2 id="due-heading" className="text-theme-text-primary mb-1 text-base font-semibold">
          Due now and coming up
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
            <span className="text-theme-text-muted ml-2 text-sm">Loading checklists...</span>
          </div>
        ) : activeChecklists.length === 0 ? (
          <div className="card p-8 text-center">
            <ClipboardCheck className="text-theme-text-muted mx-auto h-10 w-10" />
            {/* Written for the member reading it, who cannot configure
                anything: it must not imply they are off the schedule, since
                a member on a shift whose vehicle has no checklist sees this
                too. */}
            <p className="text-theme-text-muted mt-3 text-sm">
              Nothing to check right now. When one of your shifts has an equipment checklist, it will show up here. If
              you expected one, ask your shift officer.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {dueDays.map((day) => {
              const days = calendarDaysFromToday(day.key, timezone);
              // The server marks a check overdue once its shift has ended
              // unfiled, so an overnight shift still running is not flagged.
              const overdue = day.items.some((c) => c.isOverdue);
              const label = dayHeading(day.key, timezone);
              return (
                <section key={day.key} aria-label={label}>
                  <h3 className={DAY_HEADING_CLASS}>
                    {label}
                    {overdue && <span className="text-xs font-medium text-red-700 dark:text-red-400">overdue</span>}
                  </h3>
                  <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
                    {day.items.map((checklist) => {
                      const isDueNow = days !== null && days <= 0;
                      const total = checklist.totalItems ?? 0;
                      const completed = checklist.completedItems ?? 0;
                      const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
                      const isStarted = checklist.status === 'in_progress' || checklist.status === 'incomplete';
                      // One check per shift and checklist, whoever on the crew
                      // files it. Offering to open a submitted one walked the
                      // member through every item and then refused at Submit
                      // with a 409.
                      const isSubmitted = isChecklistSubmitted(checklist.status);
                      const isHighlighted = highlightShiftId === checklist.shiftId;

                      return (
                        <li
                          key={`${checklist.shiftId}-${checklist.templateId}`}
                          className={`flex items-center gap-3 px-3 py-2.5 ${
                            isHighlighted ? 'bg-blue-50/50 ring-2 ring-blue-500/30 ring-inset dark:bg-blue-950/20' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-theme-text-primary text-sm font-semibold">
                                {checklist.apparatusName}
                              </span>
                              <span
                                className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${timingBadgeClass(
                                  checklist.checkTiming
                                )}`}
                              >
                                {TIMING_SHORT[checklist.checkTiming] ?? checklist.checkTiming}
                              </span>
                            </div>
                            <p className="text-theme-text-secondary mt-0.5 truncate text-xs">
                              <span>{checklist.templateName}</span>
                              {total > 0 && !isStarted && !isSubmitted && <span> &middot; {total} items</span>}
                            </p>
                            {isStarted && total > 0 && (
                              <div className="mt-1 flex items-center gap-2">
                                <div
                                  className="bg-theme-surface-border h-1.5 max-w-32 flex-1 overflow-hidden rounded-full"
                                  role="progressbar"
                                  aria-valuenow={progressPct}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-label={`${completed} of ${total} items checked`}
                                >
                                  <div
                                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                                <span className="text-theme-text-muted text-xs tabular-nums">
                                  {completed} of {total}
                                </span>
                              </div>
                            )}
                            {isSubmitted && (
                              <p className="text-theme-text-muted mt-0.5 text-xs">Submitted for this shift</p>
                            )}
                          </div>
                          {/* The button names the action only — and a check
                              that is not due yet is still openable, just not
                              dressed as the urgent one. */}
                          {isSubmitted ? (
                            statusBadge(checklist.status)
                          ) : (
                            <button
                              onClick={() => void handleStartCheck(checklist)}
                              className={`touch:min-h-11 shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                                isDueNow || isStarted
                                  ? 'bg-red-800 text-white hover:bg-red-900'
                                  : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover border'
                              }`}
                            >
                              {isStarted ? 'Continue checklist' : 'Open checklist'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </section>

      {/* ============================================================= */}
      {/* Completed-checklist history, by day                            */}
      {/* ============================================================= */}
      <section>
        <button
          onClick={() => setShowHistory((prev) => !prev)}
          className="btn-secondary flex w-full items-center justify-between py-3 text-left"
          aria-expanded={showHistory}
          aria-controls="check-history-content"
        >
          <h2 className="text-theme-text-primary text-base font-semibold">Completed checklists</h2>
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
                className="form-input placeholder:text-theme-text-muted pr-4 pl-9 text-sm focus:ring-blue-500"
              />
            </div>

            {historyLoading ? (
              <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
                <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
                <span className="text-theme-text-muted ml-2 text-sm">Loading history...</span>
              </div>
            ) : displayedHistory.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-theme-text-muted text-sm">No check history found.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groupRuns(displayedHistory, (r) => (r.checkedAt ? toLocalISODate(r.checkedAt, timezone) : '')).map(
                  (day) => {
                    const label = day.key ? dayHeading(day.key, timezone) : 'Unknown date';
                    return (
                      <section key={day.key || 'unknown'} aria-label={label} className="space-y-2">
                        <h3 className={DAY_HEADING_CLASS}>{label}</h3>
                        {day.items.map((record) => (
                          <button
                            key={record.id}
                            onClick={() => void handleViewCheckDetail(record.id)}
                            className="border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-theme-text-primary truncate text-sm font-medium">
                                {(record.templateId && templateNames.get(record.templateId)) ||
                                  `${TIMING_LABELS[record.checkTiming] ?? 'Equipment'} check`}
                              </p>
                              <p className="text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                                {[
                                  record.checkedAt ? formatTime(record.checkedAt, timezone) : null,
                                  TIMING_SHORT[record.checkTiming] ?? record.checkTiming,
                                  record.checkedByName ?? null,
                                  `${record.completedItems} of ${record.totalItems} items`,
                                  record.failedItems > 0 ? `${record.failedItems} failed` : null,
                                ]
                                  .filter((part): part is string => Boolean(part))
                                  .map((part, index) => (
                                    <React.Fragment key={part}>
                                      {index > 0 && <span aria-hidden="true">&middot;</span>}
                                      <span>{part}</span>
                                    </React.Fragment>
                                  ))}
                              </p>
                            </div>
                            {statusBadge(record.overallStatus)}
                          </button>
                        ))}
                      </section>
                    );
                  }
                )}
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
              className="modal-overlay transition-opacity"
              onClick={() => setShowTemplatePicker(false)}
              aria-hidden="true"
            />
            {/* DialogPanel, not a bare div: without it this picker had no focus
                trap, no body scroll lock, and no registration to lift the mobile
                bottom bar — which is also z-50 and renders later, so it painted
                over the end of the template list. */}
            <DialogPanel onClose={() => setShowTemplatePicker(false)} className="relative w-full max-w-md">
              <div className="border-theme-surface-border flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-theme-text-primary text-base font-semibold">Pick a checklist</h2>
                <button
                  data-dialog-close
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
                    <p className="text-theme-text-muted mt-3 text-sm">No checklists are set up yet.</p>
                    {canManage && (
                      <Link
                        to="/inventory/admin/checklists"
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
                        className="btn-secondary group flex w-full items-center gap-3 py-3 text-left"
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
                                  : 'border-amber-500/20 bg-amber-500/10 text-amber-800 dark:text-amber-400'
                              }`}
                            >
                              {TIMING_LABELS[tmpl.checkTiming ?? ''] ?? tmpl.checkTiming}
                            </span>
                          </div>
                        </div>
                        <Play className="text-theme-text-muted h-4 w-4 transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </DialogPanel>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Phone-only ⋯ menu for the header's two links. Wider screens show the links
 * themselves. Plain links rather than a sheet: each one leaves the page, so
 * there is nothing to dismiss afterwards — only an outside tap or Escape to
 * close it without choosing.
 */
const HeaderMenu: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !el.contains(event.target as Node)) {
        el.open = false;
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className="relative sm:hidden" data-testid="checklist-header-menu">
      <summary
        className="btn-icon border-theme-surface-border text-theme-text-secondary list-none rounded-lg border [&::-webkit-details-marker]:hidden"
        aria-label="More checklist pages"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </summary>
      <div className="popover-panel absolute top-full right-0 z-30 mt-1 min-w-56 overflow-hidden py-1">
        <Link
          to="/inventory/checklists/apparatus-inventory"
          className="text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone flex items-center gap-2 px-3 py-2 text-sm"
        >
          <Boxes className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          Apparatus inventory
        </Link>
        {canManage && (
          <Link
            to="/inventory/admin/checklists"
            className="text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone flex items-center gap-2 px-3 py-2 text-sm"
          >
            <Settings className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
            Manage templates
          </Link>
        )}
      </div>
    </details>
  );
};

export default MyChecklistsPage;
