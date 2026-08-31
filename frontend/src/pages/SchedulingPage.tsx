import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { useDialog } from '../hooks/useDialog';
import {
  Clock,
  CalendarDays,
  Plus,
  AlertCircle,
  X,
  Loader2,
  Users,
  UserPlus,
  ArrowLeftRight,
  ClipboardList,
  BarChart3,
  Settings,
  Repeat,
  FileText,
  Truck,
  ShieldCheck,
  ChevronDown,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatTimeOfDay, localToUTC } from '../utils/dateFormatting';
import { enumLabel } from '../utils/displayValue';
import { schedulingService, useSchedulingStore } from '../modules/scheduling';
import type { ShiftRecord, ShiftTemplateRecord } from '../modules/scheduling';
import { resolveTemplatePositions } from '../modules/scheduling/services/api';
import { trainingModuleConfigService } from '../services/api';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import TimeQuarterHour from '../components/ux/TimeQuarterHour';
import SchedulingHeader from './scheduling/SchedulingHeader';
import ShiftBoard from './scheduling/board/ShiftBoard';

// Lazy-loaded tab components
const MyShiftsTab = lazyWithRetry(() => import('./scheduling/MyShiftsTab'));
const OpenShiftsTab = lazyWithRetry(() => import('./scheduling/OpenShiftsTab'));
const RequestsTab = lazyWithRetry(() => import('./scheduling/RequestsTab'));
const ShiftDetailPanel = lazyWithRetry(() => import('./scheduling/ShiftDetailPanel'));
const ShiftReportsTab = lazyWithRetry(() => import('./scheduling/ShiftReportsTab'));

type TabId = 'schedule' | 'my-shifts' | 'open-shifts' | 'requests' | 'shift-reports';
type ViewMode = 'week' | 'month';

const TAB_IDS: TabId[] = ['schedule', 'my-shifts', 'open-shifts', 'requests', 'shift-reports'];

const isTabId = (value: string | null): value is TabId => value !== null && (TAB_IDS as string[]).includes(value);
const isViewMode = (value: string | null): value is ViewMode => value === 'week' || value === 'month';

const parseCalendarDate = (value: string | null): Date | null => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) || formatDateISO(date) !== value ? null : date;
};

// Fallback templates when no backend templates are configured
const FALLBACK_TEMPLATES: ShiftTemplateRecord[] = [
  {
    id: '_day',
    name: 'Day Shift',
    start_time_of_day: '07:00',
    end_time_of_day: '19:00',
    duration_hours: 12,
    min_staffing: 4,
    is_default: true,
    is_active: true,
  },
  {
    id: '_night',
    name: 'Night Shift',
    start_time_of_day: '19:00',
    end_time_of_day: '07:00',
    duration_hours: 12,
    min_staffing: 4,
    is_default: false,
    is_active: true,
  },
  {
    id: '_24hr',
    name: '24 Hour',
    start_time_of_day: '07:00',
    end_time_of_day: '07:00',
    duration_hours: 24,
    min_staffing: 4,
    is_default: false,
    is_active: true,
  },
];

const formatDateISO = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Compute the end date for a shift given its start date and template times. */
const computeEndDate = (startDate: string, template: ShiftTemplateRecord | undefined): string => {
  if (!startDate || !template) return '';
  const [startHour = 0] = template.start_time_of_day.split(':').map(Number);
  const [endHour = 0] = template.end_time_of_day.split(':').map(Number);
  // Same-day shift: end time is after start time and not a 24-hour shift
  if (endHour > startHour && template.duration_hours < 24) {
    return startDate;
  }
  // Overnight or 24-hour shift: end date is the next day
  const nextDay = new Date(startDate + 'T12:00:00'); // noon to avoid DST edge cases
  nextDay.setDate(nextDay.getDate() + 1);
  return formatDateISO(nextDay);
};

const TAB_CONFIG: {
  id: TabId;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'my-shifts', label: 'My Shifts', icon: Clock },
  { id: 'open-shifts', label: 'Open Shifts', icon: UserPlus },
  { id: 'requests', label: 'Requests', icon: ArrowLeftRight },
  { id: 'shift-reports', label: 'Shift Reports', icon: FileText },
];

const ADMIN_LINKS: {
  label: string;
  path: string;
  icon: React.ElementType;
  description: string;
}[] = [
  { label: 'Templates', path: '/scheduling/templates', icon: ClipboardList, description: 'Manage shift templates' },
  { label: 'Patterns', path: '/scheduling/patterns', icon: Repeat, description: 'Configure shift patterns' },
  { label: 'Reports', path: '/scheduling/reports', icon: BarChart3, description: 'View scheduling reports' },
  {
    label: 'Qualifications',
    path: '/scheduling/qualifications',
    icon: ShieldCheck,
    description: 'Who is cleared per position',
  },
  { label: 'Settings', path: '/scheduling/settings', icon: Settings, description: 'Department settings' },
];

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
    <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
  </div>
);

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const navigate = useNavigate();
  const tz = useTimezone();
  const canManage = checkPermission('scheduling.manage');

  const [shiftReportsEnabled, setShiftReportsEnabled] = useState(true);
  const visibleTabs = useMemo(
    () => TAB_CONFIG.filter((tab) => shiftReportsEnabled || tab.id !== 'shift-reports'),
    [shiftReportsEnabled]
  );
  const [searchParams, setSearchParams] = useSearchParams();

  // Shared store — members, templates, apparatus loaded once and cached
  const {
    members: membersList,
    templates: backendTemplates,
    templatesLoaded,
    apparatus: apparatusList,
    summary,
    platoonsEnabled,
    loadInitialData,
    loadSummary,
  } = useSchedulingStore();

  // Platoons admin page is only relevant when platoon scheduling is enabled.
  const adminLinks = useMemo(
    () =>
      platoonsEnabled
        ? [
            ...ADMIN_LINKS,
            { label: 'Platoons', path: '/scheduling/platoons', icon: Users, description: 'Assign platoon rosters' },
          ]
        : ADMIN_LINKS,
    [platoonsEnabled]
  );

  // Tab state — honour ?tab= query param for deep-linking
  const initialTabParam = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabId>(isTabId(initialTabParam) ? initialTabParam : 'schedule');

  // Clicking a tab writes the choice to the URL as well as to state, so the
  // sync effect below reads back the tab the user just picked. An earlier
  // version only set state; the effect then saw no ?tab= (i.e. "schedule"),
  // decided state had drifted, and snapped every tab straight back to Schedule
  // — no tab but Schedule could be opened at all.
  const handleTabChange = useCallback(
    (tabId: TabId) => {
      setActiveTab(tabId);
      const next = new URLSearchParams(searchParams);
      if (tabId === 'schedule') {
        next.delete('tab');
      } else {
        next.set('tab', tabId);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  // A tab can disappear after the page has already opened it: both the module
  // switch and the shift-reports flag resolve asynchronously, and ?tab= is
  // deep-linked from notification emails that were sent while the tab existed.
  // Without this the tab strip loses the button and the body renders nothing,
  // which reads as a broken page rather than a disabled feature.
  useEffect(() => {
    if (visibleTabs.some((tab) => tab.id === activeTab)) return;
    handleTabChange('schedule');
  }, [visibleTabs, activeTab, handleTabChange]);

  const handleTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, currentTab: TabId) => {
      const currentIndex = visibleTabs.findIndex((tab) => tab.id === currentTab);
      let nextIndex: number | undefined;

      if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % visibleTabs.length;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + visibleTabs.length) % visibleTabs.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = visibleTabs.length - 1;
      if (nextIndex === undefined) return;

      event.preventDefault();
      const nextTab = visibleTabs[nextIndex];
      if (!nextTab) return;
      handleTabChange(nextTab.id);
      requestAnimationFrame(() => document.getElementById(`scheduling-tab-${nextTab.id}`)?.focus());
    },
    [handleTabChange, visibleTabs]
  );

  // Sync tab state when the URL changes underneath us (deep link, back button).
  // A missing ?tab= is not a request to reset — it is the Schedule default that
  // handleTabChange writes, and re-asserting it here would fight local state.
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isTabId(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Load shift reports feature flag. Failure here must not blank the page —
  // a single config-endpoint regression should leave the rest of scheduling
  // usable, so we fall back to the default and surface the error in the
  // console for diagnosability.
  useEffect(() => {
    trainingModuleConfigService
      .getConfig()
      .then((cfg) => setShiftReportsEnabled(cfg.shift_reports_enabled ?? true))
      .catch((err: unknown) => {
        console.warn(
          'SchedulingPage: failed to load training module config; defaulting shift_reports_enabled=true',
          err
        );
      });
  }, []);

  // Calendar state
  const initialViewParam = searchParams.get('view');
  const [viewMode, setViewMode] = useState<ViewMode>(isViewMode(initialViewParam) ? initialViewParam : 'week');
  const [currentDate, setCurrentDate] = useState(() => parseCalendarDate(searchParams.get('date')) ?? new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

  // The calendar's own data lives in ShiftBoard: it fetches the visible range
  // with the roster attached and mutates it optimistically, so a second copy
  // up here could only ever be the stale one. `boardRefreshKey` is how this
  // page asks it to re-read after creating a shift.
  const [boardRefreshKey, setBoardRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  // Shift detail panel
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

  // Deep-link: open shift detail panel when ?shift=<id> is in the URL.
  // Skip if a specific tab is targeted (e.g. shift-reports from a notification)
  // so the shift panel doesn't obscure the tab content.
  useEffect(() => {
    const shiftId = searchParams.get('shift');
    const targetTab = searchParams.get('tab');
    if (!shiftId) return;
    if (targetTab && targetTab !== 'schedule') return;

    let cancelled = false;
    const openShift = async () => {
      try {
        const shift = await schedulingService.getShift(shiftId);
        if (!cancelled) {
          setSelectedShift(shift);
          searchParams.delete('shift');
          setSearchParams(searchParams, { replace: true });
        }
      } catch {
        searchParams.delete('shift');
        setSearchParams(searchParams, { replace: true });
      }
    };
    void openShift();
    return () => {
      cancelled = true;
    };
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effective templates: backend if available, otherwise fallbacks
  const effectiveTemplates = useMemo(() => {
    const active = backendTemplates.filter((t) => t.is_active);
    return active.length > 0 ? active : FALLBACK_TEMPLATES;
  }, [backendTemplates]);

  const usingFallbackTemplates = backendTemplates.filter((t) => t.is_active).length === 0 && templatesLoaded;

  const defaultTemplate = useMemo(() => {
    return effectiveTemplates.find((t) => t.is_default) || effectiveTemplates[0];
  }, [effectiveTemplates]);

  const [shiftForm, setShiftForm] = useState({
    shiftTemplate: '',
    startDate: '',
    endDate: '',
    notes: '',
    apparatus_id: '',
    shift_officer_id: '',
    customStartTime: '',
    customEndTime: '',
  });

  // Load shared reference data once via the Zustand store
  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // Keep the calendar location shareable and preserve it across browser history.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('view', viewMode);
    next.set('date', formatDateISO(currentDate));
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [currentDate, searchParams, setSearchParams, viewMode]);

  // Fetch summary on mount via the store
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const handleCreateShift = async () => {
    if (!shiftForm.startDate) {
      setCreateError('Start date is required.');
      return;
    }
    if (apparatusList.length > 0 && !shiftForm.apparatus_id) {
      setCreateError('Select the apparatus for this shift.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const template = effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
      if (!template) {
        setCreateError('No shift template available. Please create a template first.');
        setCreating(false);
        return;
      }
      const startTime = shiftForm.customStartTime || template.start_time_of_day;
      const endTime = shiftForm.customEndTime || template.end_time_of_day;

      // Use the form's end date (auto-computed or user-overridden)
      const endDate = shiftForm.endDate || computeEndDate(shiftForm.startDate, template) || shiftForm.startDate;

      // Convert local times to UTC so the backend stores correct values
      const startDateTime = localToUTC(`${shiftForm.startDate}T${startTime}`, tz);
      let endDateTime = localToUTC(`${endDate}T${endTime}`, tz);
      // Overnight guard: if custom times make the end fall on/before the start
      // (e.g. 19:00 → 07:00 on the same date), roll the end to the next day so
      // the backend doesn't reject it (end_time must be after start_time).
      if (new Date(endDateTime) <= new Date(startDateTime)) {
        const rolled = new Date(endDateTime);
        rolled.setUTCDate(rolled.getUTCDate() + 1);
        endDateTime = rolled.toISOString();
      }

      const selectedApparatus = apparatusList.find((a) => a.id === shiftForm.apparatus_id);
      const apparatusPositions = selectedApparatus?.positions;
      const templatePositions = resolveTemplatePositions(template.positions);
      const shiftPositions = apparatusPositions?.length ? apparatusPositions : templatePositions;

      await schedulingService.createShift({
        shift_date: shiftForm.startDate,
        start_time: startDateTime,
        end_time: endDateTime,
        ...(shiftForm.notes ? { notes: shiftForm.notes } : {}),
        ...(shiftForm.apparatus_id ? { apparatus_id: shiftForm.apparatus_id } : {}),
        ...(shiftForm.shift_officer_id ? { shift_officer_id: shiftForm.shift_officer_id } : {}),
        ...(template.color ? { color: template.color } : {}),
        ...(shiftPositions.length > 0 ? { positions: shiftPositions } : {}),
        ...(selectedApparatus?.min_staffing || template.min_staffing
          ? { min_staffing: selectedApparatus?.min_staffing || template.min_staffing }
          : {}),
      });

      // Tell the board to re-read the range it is showing, and refresh the
      // department totals above it.
      setBoardRefreshKey((key) => key + 1);
      void loadSummary();

      setShiftForm({
        shiftTemplate: defaultTemplate?.id || '',
        startDate: '',
        endDate: '',
        notes: '',
        apparatus_id: '',
        shift_officer_id: '',
        customStartTime: '',
        customEndTime: '',
      });
      setShowCreateShift(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create shift';
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleShiftClick = (shift: ShiftRecord) => {
    setSelectedShift(shift);
  };

  const dialogRef = useDialog<HTMLDivElement>({ isOpen: showCreateShift, onClose: () => setShowCreateShift(false) });

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <SchedulingHeader
          actions={
            canManage && activeTab === 'schedule' ? (
              <button
                onClick={() => setShowCreateShift(true)}
                className="flex min-h-11 w-full items-center justify-center space-x-2 rounded-lg bg-violet-600 px-4 py-2 text-white transition-colors hover:bg-violet-700 sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create Shift</span>
              </button>
            ) : undefined
          }
        />
        {/* Tab Navigation */}
        <div className="border-theme-surface-border relative -mx-4 mb-6 border-b px-4 sm:mx-0 sm:px-0">
          <div
            className="flex scrollbar-thin space-x-1 overflow-x-auto scroll-smooth"
            data-mobile-scroll-region
            role="tablist"
            aria-label="Scheduling views"
            tabIndex={0}
          >
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`scheduling-tab-${tab.id}`}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleTabChange(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
                  className={`focus-visible:ring-theme-focus-ring flex min-h-[44px] items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:px-4 ${
                    isActive
                      ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
          {/* Scroll fade hint on right edge (mobile) */}
          <div
            className="from-theme-bg pointer-events-none absolute top-0 right-0 bottom-0 w-8 bg-linear-to-l to-transparent sm:hidden"
            aria-hidden="true"
          />
        </div>

        {/* Officer tools.
            These sat under the month grid as seven cards headed
            "ADMINISTRATION", so an officer reached them only by scrolling a
            whole calendar past — and on a phone each carried an
            external-link arrow, though every one is an ordinary page in this
            app. A strip above the content instead: same links, no scrolling,
            and the Supply count says what it is counting. */}
        {canManage && (
          <nav className="mb-6" aria-labelledby="officer-tools-heading">
            <h2 id="officer-tools-heading" className="text-theme-text-muted mb-2 text-xs font-semibold">
              Officer tools
            </h2>
            <div className="hscroll flex gap-2">
              {adminLinks.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    title={link.description}
                    className="btn-secondary btn-auto mobile-touch-target inline-flex shrink-0 items-center gap-2 px-3 text-sm font-medium"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>
        )}

        {/* Tab Content */}
        {activeTab === 'schedule' && (
          <>
            {/* Summary Stats */}
            {summary && (
              <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
                {/* Each label names its own window and whose figure it is. Three
                    of these count scheduled shifts over different spans and the
                    fourth sums hours the department actually worked; under
                    "Scheduled Shifts" / "This Month" the first and third read as
                    the same measure, and matched exactly whenever every shift on
                    record happened to fall in the current month. */}
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">Shifts on record (all dates)</p>
                  <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">{summary.shifts_scheduled}</p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">Shifts this week</p>
                  <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">
                    {summary.shifts_scheduled_this_week}
                  </p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">Shifts this month</p>
                  <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">
                    {summary.shifts_scheduled_this_month}
                  </p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">Department hours this month</p>
                  <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">
                    {summary.hours_worked_this_month}
                  </p>
                </div>
              </div>
            )}

            {/* The board: month grid, day panel, and one-tap claim. Replaces
                the old month/week grid of ShiftCards — a card told you a shift
                existed; the board tells you whether it still needs somebody
                and lets you be that somebody without leaving the page. */}
            <ShiftBoard
              view={viewMode === 'week' ? 'week' : 'month'}
              visibleDate={currentDate}
              onVisibleDateChange={setCurrentDate}
              onViewChange={setViewMode}
              refreshKey={boardRefreshKey}
              onViewShift={handleShiftClick}
              emptyAction={
                canManage ? (
                  <button
                    onClick={() => setShowCreateShift(true)}
                    className="btn-primary inline-flex items-center gap-2 rounded-lg"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <span>Create the first shift</span>
                  </button>
                ) : undefined
              }
            />
          </>
        )}

        {/* Other Tabs */}
        {activeTab !== 'schedule' && (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === 'my-shifts' && <MyShiftsTab onViewShift={handleShiftClick} />}
            {activeTab === 'open-shifts' && <OpenShiftsTab onViewShift={handleShiftClick} />}
            {activeTab === 'requests' && <RequestsTab />}
            {activeTab === 'shift-reports' && <ShiftReportsTab />}
          </Suspense>
        )}

        {/* Shift Detail Panel */}
        {selectedShift && (
          <Suspense fallback={null}>
            <ShiftDetailPanel
              shift={selectedShift}
              onClose={() => setSelectedShift(null)}
              onRefresh={() => setBoardRefreshKey((key) => key + 1)}
            />
          </Suspense>
        )}

        {/* Create Shift Modal */}
        {showCreateShift && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-schedule-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setShowCreateShift(false);
            }}
          >
            <div className="flex min-h-screen items-center justify-center px-4">
              <div className="modal-overlay" onClick={() => setShowCreateShift(false)} aria-hidden="true" />
              <div ref={dialogRef} className="modal-panel relative w-full max-w-lg">
                <div className="px-6 pt-5 pb-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 id="create-schedule-title" className="text-theme-text-primary text-lg font-medium">
                      Create Shift
                    </h3>
                    <button
                      onClick={() => setShowCreateShift(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Shift Template</label>
                      {effectiveTemplates.length > 5 && (
                        <input
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          type="text"
                          placeholder="Search templates..."
                          value={templateSearch}
                          onChange={(e) => setTemplateSearch(e.target.value)}
                          className="form-input mb-2 text-sm focus:ring-violet-500"
                        />
                      )}
                      <select
                        value={shiftForm.shiftTemplate}
                        onChange={(e) => {
                          const tmpl = effectiveTemplates.find((t) => t.id === e.target.value);
                          setShiftForm((prev) => ({
                            ...prev,
                            shiftTemplate: e.target.value,
                            endDate: computeEndDate(prev.startDate, tmpl),
                            apparatus_id:
                              tmpl?.apparatus_id && apparatusList.some((a) => a.id === tmpl.apparatus_id)
                                ? tmpl.apparatus_id
                                : prev.apparatus_id,
                          }));
                        }}
                        className="form-input focus:ring-violet-500"
                        size={effectiveTemplates.length > 5 ? Math.min(8, effectiveTemplates.length) : undefined}
                      >
                        {(() => {
                          const q = templateSearch.toLowerCase();
                          const filtered = q
                            ? effectiveTemplates.filter(
                                (t) =>
                                  t.name.toLowerCase().includes(q) ||
                                  (t.apparatus_type ?? '').toLowerCase().includes(q) ||
                                  (t.category ?? '').toLowerCase().includes(q)
                              )
                            : effectiveTemplates;

                          const standard = filtered.filter((t) => !t.category || t.category === 'standard');
                          const specialty = filtered.filter((t) => t.category === 'specialty');
                          const event = filtered.filter((t) => t.category === 'event');
                          return (
                            <>
                              {standard.length > 0 && (
                                <optgroup label="Standard Shifts">
                                  {standard.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                      {t.apparatus_type ? ` — ${enumLabel(t.apparatus_type)}` : ''} (
                                      {formatTimeOfDay(t.start_time_of_day)} - {formatTimeOfDay(t.end_time_of_day)})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {specialty.length > 0 && (
                                <optgroup label="Specialty Vehicle">
                                  {specialty.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({formatTimeOfDay(t.start_time_of_day)} -{' '}
                                      {formatTimeOfDay(t.end_time_of_day)})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {event.length > 0 && (
                                <optgroup label="Event / Special">
                                  {event.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({formatTimeOfDay(t.start_time_of_day)} -{' '}
                                      {formatTimeOfDay(t.end_time_of_day)})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {standard.length === 0 &&
                                specialty.length === 0 &&
                                event.length === 0 &&
                                filtered.length > 0 &&
                                filtered.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({formatTimeOfDay(t.start_time_of_day)} -{' '}
                                    {formatTimeOfDay(t.end_time_of_day)})
                                  </option>
                                ))}
                              {filtered.length === 0 && (
                                <option value="" disabled>
                                  No templates match &ldquo;{templateSearch}&rdquo;
                                </option>
                              )}
                            </>
                          );
                        })()}
                      </select>
                      {/* Template info preview */}
                      {(() => {
                        const tmpl =
                          effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
                        if (!tmpl) return null;
                        const flatPositions = resolveTemplatePositions(tmpl.positions);
                        const hasPositions = flatPositions.length > 0;
                        const catLabel =
                          tmpl.category === 'specialty' ? 'Specialty' : tmpl.category === 'event' ? 'Event' : null;
                        return (
                          <div className="bg-theme-surface-hover/50 mt-2 space-y-1.5 rounded-lg p-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-theme-text-muted">
                                  Duration:{' '}
                                  <span className="text-theme-text-primary font-medium">{tmpl.duration_hours}h</span>
                                </span>
                                {catLabel && (
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      tmpl.category === 'specialty'
                                        ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400'
                                        : 'bg-purple-500/10 text-purple-700 dark:text-purple-400'
                                    }`}
                                  >
                                    {catLabel}
                                  </span>
                                )}
                              </div>
                              <span className="text-theme-text-muted">
                                Min staffing:{' '}
                                <span className="text-theme-text-primary font-medium">{tmpl.min_staffing}</span>
                              </span>
                            </div>
                            {tmpl.apparatus_type && (
                              <p className="text-theme-text-muted flex items-center gap-1 text-xs">
                                <Truck className="h-3 w-3" /> Vehicle type:{' '}
                                <span className="text-theme-text-primary font-medium">
                                  {enumLabel(tmpl.apparatus_type)}
                                </span>
                              </p>
                            )}
                            {hasPositions && (
                              <div>
                                <p className="text-theme-text-muted mb-1 text-xs">Required positions:</p>
                                <div className="flex flex-wrap gap-1">
                                  {flatPositions.map((slot, i) => (
                                    <span
                                      key={i}
                                      className={`rounded-sm px-2 py-0.5 text-[10px] font-medium capitalize ${slot.required ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-theme-surface-hover text-theme-text-muted'}`}
                                    >
                                      {slot.position}
                                      {!slot.required && ' (opt)'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {usingFallbackTemplates && (
                        <p className="text-theme-text-muted mt-1.5 text-xs">
                          Using default templates.{' '}
                          <button
                            type="button"
                            onClick={() => {
                              setShowCreateShift(false);
                              void navigate('/scheduling/templates');
                            }}
                            className="text-violet-600 hover:underline dark:text-violet-400"
                          >
                            Configure your own
                          </button>{' '}
                          on the Templates page.
                        </p>
                      )}
                    </div>

                    {/* Start / End Date — always visible */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Start Date *</label>
                        <input
                          type="date"
                          value={shiftForm.startDate}
                          onChange={(e) => {
                            const newStart = e.target.value;
                            const tmpl =
                              effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
                            setShiftForm((prev) => ({
                              ...prev,
                              startDate: newStart,
                              endDate: computeEndDate(newStart, tmpl),
                            }));
                          }}
                          className="form-input focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-sm font-medium">End Date</label>
                        <input
                          type="date"
                          value={shiftForm.endDate}
                          onChange={(e) =>
                            setShiftForm({
                              ...shiftForm,
                              endDate: e.target.value,
                            })
                          }
                          className="form-input focus:ring-violet-500"
                        />
                        {shiftForm.startDate &&
                          shiftForm.endDate &&
                          (() => {
                            const tmpl =
                              effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
                            if (!tmpl) return null;
                            const sameDay = shiftForm.startDate === shiftForm.endDate;
                            return (
                              <p className="text-theme-text-muted mt-1 text-xs">
                                {formatTimeOfDay(tmpl.start_time_of_day)} &rarr; {formatTimeOfDay(tmpl.end_time_of_day)}{' '}
                                ({sameDay ? 'same day' : 'next day'})
                              </p>
                            );
                          })()}
                      </div>
                    </div>

                    {/* Apparatus Selection */}
                    {apparatusList.length > 0 && (
                      <div>
                        <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                          <span className="flex items-center gap-1.5">
                            <Truck className="h-4 w-4" /> Apparatus <span aria-hidden="true">*</span>
                          </span>
                        </label>
                        <select
                          value={shiftForm.apparatus_id}
                          onChange={(e) =>
                            setShiftForm({
                              ...shiftForm,
                              apparatus_id: e.target.value,
                            })
                          }
                          className="form-input focus:ring-violet-500"
                          required
                          aria-required="true"
                        >
                          <option value="">Select apparatus...</option>
                          {apparatusList.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.unit_number} — {a.name}
                            </option>
                          ))}
                        </select>
                        {(() => {
                          const selected = apparatusList.find((a) => a.id === shiftForm.apparatus_id);
                          if (selected?.positions && selected.positions.length > 0) {
                            return (
                              <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
                                <p className="mb-1.5 text-xs font-medium text-violet-700 dark:text-violet-400">
                                  Positions on {selected.unit_number}:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {selected.positions.map((slot, i) => {
                                    const name = slot.position;
                                    return (
                                      <span
                                        key={i}
                                        className="rounded-sm bg-violet-500/10 px-2 py-0.5 text-xs text-violet-700 capitalize dark:text-violet-300"
                                      >
                                        {name}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          }
                          if (shiftForm.apparatus_id) {
                            return (
                              <p className="text-theme-text-muted mt-1 text-xs">
                                No positions defined — members can sign up with any position.
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    )}

                    {/* Auto-generated shift label preview */}
                    {(() => {
                      const tmpl = effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
                      const apparatus = apparatusList.find((a) => a.id === shiftForm.apparatus_id);
                      if (!tmpl) return null;
                      const suffix =
                        tmpl.duration_hours >= 24 ? '24' : tmpl.start_time_of_day < tmpl.end_time_of_day ? 'DS' : 'NS';
                      const label = apparatus ? `${apparatus.unit_number} ${suffix}` : `${tmpl.name}`;
                      return (
                        <div className="bg-theme-surface-hover/50 border-theme-surface-border flex items-center gap-2 rounded-lg border p-2.5">
                          <span className="text-theme-text-muted text-xs">Shift label:</span>
                          <span className="text-theme-text-primary text-sm font-semibold">{label}</span>
                        </div>
                      );
                    })()}

                    {/* Collapsible additional options */}
                    <div className="border-theme-surface-border overflow-hidden rounded-lg border">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                        className="text-theme-text-secondary hover:bg-theme-surface-hover flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <Settings className="h-3.5 w-3.5" />
                          Additional Options
                          {(shiftForm.apparatus_id ||
                            shiftForm.shift_officer_id ||
                            shiftForm.customStartTime ||
                            shiftForm.customEndTime ||
                            shiftForm.notes) && <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />}
                        </span>
                        <ChevronDown
                          className={`text-theme-text-muted h-4 w-4 transition-transform duration-200 ${showAdvancedOptions ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      {showAdvancedOptions && (
                        <div className="border-theme-surface-border space-y-4 border-t px-4 pt-1 pb-4">
                          {/* Custom Time Override */}
                          <div>
                            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-4 w-4" /> Custom Times
                              </span>
                            </label>
                            <p className="text-theme-text-muted mb-2 text-xs">
                              Override the template times for this shift
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-theme-text-muted mb-1 block text-xs">Start Time</label>
                                <TimeQuarterHour
                                  value={shiftForm.customStartTime}
                                  onChange={(e) => setShiftForm({ ...shiftForm, customStartTime: e.target.value })}
                                  placeholder={(() => {
                                    const tmpl =
                                      effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) ||
                                      defaultTemplate;
                                    return tmpl?.start_time_of_day || '';
                                  })()}
                                  className="form-input"
                                />
                              </div>
                              <div>
                                <label className="text-theme-text-muted mb-1 block text-xs">End Time</label>
                                <TimeQuarterHour
                                  value={shiftForm.customEndTime}
                                  onChange={(e) => setShiftForm({ ...shiftForm, customEndTime: e.target.value })}
                                  className="form-input"
                                />
                              </div>
                            </div>
                            {(shiftForm.customStartTime || shiftForm.customEndTime) && (
                              <button
                                type="button"
                                onClick={() => setShiftForm({ ...shiftForm, customStartTime: '', customEndTime: '' })}
                                className="text-theme-text-muted mt-1 text-xs hover:text-violet-500"
                              >
                                Reset to template times
                              </button>
                            )}
                          </div>

                          {/* Shift Officer Selection */}
                          {membersList.length > 0 && (
                            <div>
                              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                                <span className="flex items-center gap-1.5">
                                  <Users className="h-4 w-4" /> Shift Officer
                                </span>
                              </label>
                              <select
                                value={shiftForm.shift_officer_id}
                                onChange={(e) =>
                                  setShiftForm({
                                    ...shiftForm,
                                    shift_officer_id: e.target.value,
                                  })
                                }
                                className="form-input focus:ring-violet-500"
                              >
                                <option value="">No shift officer</option>
                                {membersList.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Notes */}
                          <div>
                            <label className="text-theme-text-secondary mb-1 block text-sm font-medium">Notes</label>
                            <textarea
                              value={shiftForm.notes}
                              onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
                              rows={2}
                              className="form-input resize-none focus:ring-violet-500"
                              placeholder="Optional notes for this shift..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {createError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                        <div className="flex items-start space-x-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-400" />
                          <p className="text-sm text-red-700 dark:text-red-300">{createError}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-theme-input-bg flex justify-end space-x-3 rounded-b-lg px-6 py-3">
                  <button
                    onClick={() => {
                      setShowCreateShift(false);
                      setCreateError(null);
                    }}
                    className="border-theme-input-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateShift();
                    }}
                    disabled={creating || !shiftForm.startDate}
                    className={`inline-flex items-center space-x-2 rounded-lg px-4 py-2 transition-colors ${
                      creating || !shiftForm.startDate
                        ? 'cursor-not-allowed bg-violet-600 text-white opacity-50'
                        : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                  >
                    {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                    <span>{creating ? 'Creating...' : 'Create Shift'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SchedulingPage;
