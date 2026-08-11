import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import {
  Clock,
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
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
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { useTheme } from '../contexts/ThemeContext';
import { formatDateCustom, formatTimeOfDay, localToUTC } from '../utils/dateFormatting';
import { enumLabel } from '../utils/displayValue';
import { schedulingService, useSchedulingStore } from '../modules/scheduling';
import type { ShiftRecord, ShiftTemplateRecord } from '../modules/scheduling';
import { resolveTemplatePositions } from '../modules/scheduling/services/api';
import ShiftCard from './scheduling/ShiftCard';
import { trainingModuleConfigService } from '../services/api';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import TimeQuarterHour from '../components/ux/TimeQuarterHour';

// Lazy-loaded tab components
const MyShiftsTab = lazyWithRetry(() => import('./scheduling/MyShiftsTab'));
const OpenShiftsTab = lazyWithRetry(() => import('./scheduling/OpenShiftsTab'));
const RequestsTab = lazyWithRetry(() => import('./scheduling/RequestsTab'));
const ShiftDetailPanel = lazyWithRetry(() => import('./scheduling/ShiftDetailPanel'));
const ShiftReportsTab = lazyWithRetry(() => import('./scheduling/ShiftReportsTab'));
const MyChecklistsPage = lazyWithRetry(() => import('./scheduling/MyChecklistsPage'));

type TabId = 'schedule' | 'my-shifts' | 'open-shifts' | 'requests' | 'equipment-checks' | 'shift-reports';
type ViewMode = 'week' | 'month';

const TAB_IDS: TabId[] = ['schedule', 'my-shifts', 'open-shifts', 'requests', 'equipment-checks', 'shift-reports'];

const isTabId = (value: string | null): value is TabId => value !== null && (TAB_IDS as string[]).includes(value);

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

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  { id: 'equipment-checks', label: 'Equipment Checks', icon: ClipboardList },
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
    label: 'Check Reports',
    path: '/scheduling/equipment-check-reports',
    icon: ClipboardList,
    description: 'Equipment compliance',
  },
  { label: 'Supply', path: '/scheduling/supply/expiring', icon: Truck, description: 'Expiring items & stock' },
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
  const { resolvedTheme } = useTheme();
  const canManage = checkPermission('scheduling.manage');

  // Expiring-item count for the "Supply" admin card badge.
  const [supplyCount, setSupplyCount] = useState<number | null>(null);
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void schedulingService
      .getSupplyExpiringItems(30)
      .then((res) => {
        if (!cancelled) setSupplyCount(res.total);
      })
      .catch(() => {
        /* non-critical — badge just won't show */
      });
    return () => {
      cancelled = true;
    };
  }, [canManage]);
  const [shiftReportsEnabled, setShiftReportsEnabled] = useState(true);
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
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');

  // Shift detail panel
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

  // Deep-link: open shift detail panel when ?shift=<id> is in the URL.
  // Skip if a specific tab is targeted (e.g. equipment-checks from a notification)
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

  const weekDates = useMemo(() => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate]);

  const monthDates = useMemo(() => {
    if (viewMode !== 'month') return [];
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startPad = firstDay.getDay();
    const start = new Date(firstDay);
    start.setDate(start.getDate() - startPad);
    const totalDays = startPad + lastDay.getDate();
    const rows = Math.ceil(totalDays / 7);
    return Array.from({ length: rows * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [currentDate, viewMode]);

  // Pre-index shifts by date for O(1) lookups instead of filtering per cell
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, ShiftRecord[]>();
    for (const shift of shifts) {
      const existing = map.get(shift.shift_date);
      if (existing) {
        existing.push(shift);
      } else {
        map.set(shift.shift_date, [shift]);
      }
    }
    return map;
  }, [shifts]);

  const navigate_ = (direction: number) => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else {
      newDate.setDate(newDate.getDate() + direction * 7);
    }
    setCurrentDate(newDate);
  };

  const dateRangeLabel = useMemo(() => {
    if (viewMode === 'month') {
      return formatDateCustom(
        currentDate,
        {
          month: 'long',
          year: 'numeric',
        },
        tz
      );
    }
    const start = weekDates[0] ?? currentDate;
    const end = weekDates[6] ?? currentDate;
    const startMonth = formatDateCustom(
      start,
      {
        month: 'short',
      },
      tz
    );
    const endMonth = formatDateCustom(
      end,
      {
        month: 'short',
      },
      tz
    );
    if (startMonth === endMonth) {
      return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }, [currentDate, viewMode, weekDates, tz]);

  const isToday = (date: Date) => {
    const today = new Date();
    return (
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear()
    );
  };

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let fetchedShifts: ShiftRecord[];
      if (viewMode === 'month') {
        fetchedShifts = await schedulingService.getMonthCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
      } else {
        const weekStartStr = formatDateISO(weekDates[0] ?? currentDate);
        fetchedShifts = await schedulingService.getWeekCalendar(weekStartStr);
      }
      setShifts(fetchedShifts);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load shifts';
      setError(message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate, viewMode]);

  useEffect(() => {
    void fetchShifts();
  }, [fetchShifts]);

  // Fetch summary on mount via the store
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const getShiftsForDate = useCallback(
    (date: Date): ShiftRecord[] => {
      return shiftsByDate.get(formatDateISO(date)) || [];
    },
    [shiftsByDate]
  );

  const handleCreateShift = async () => {
    if (!shiftForm.startDate) {
      setCreateError('Start date is required.');
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

      const templatePositions = resolveTemplatePositions(template.positions);

      await schedulingService.createShift({
        shift_date: shiftForm.startDate,
        start_time: startDateTime,
        end_time: endDateTime,
        ...(shiftForm.notes ? { notes: shiftForm.notes } : {}),
        ...(shiftForm.apparatus_id ? { apparatus_id: shiftForm.apparatus_id } : {}),
        ...(shiftForm.shift_officer_id ? { shift_officer_id: shiftForm.shift_officer_id } : {}),
        ...(template.color ? { color: template.color } : {}),
        ...(templatePositions.length > 0 ? { positions: templatePositions } : {}),
        ...(template.min_staffing ? { min_staffing: template.min_staffing } : {}),
      });

      // Refresh shifts and summary
      await fetchShifts();
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

  const hasShifts = shifts.length > 0;

  const visibleTabs = shiftReportsEnabled ? TAB_CONFIG : TAB_CONFIG.filter((t) => t.id !== 'shift-reports');

  return (
    <div className="min-h-screen">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {/* Page Header */}
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center space-x-3">
            <div className="rounded-lg bg-violet-600 p-2">
              <Clock className="h-6 w-6 text-white" aria-hidden="true" />
            </div>
            <div>
              {/* The nav calls this "Shift Scheduling"; the page called itself
                  "Scheduling & Shifts". Two names for one screen. */}
              <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">Shift Scheduling</h1>
              <p className="text-theme-text-muted text-sm">Manage schedules, sign up for shifts, and handle trades</p>
            </div>
          </div>
          {canManage && activeTab === 'schedule' && (
            <button
              onClick={() => setShowCreateShift(true)}
              className="flex w-full items-center justify-center space-x-2 rounded-lg bg-violet-600 px-4 py-2 text-white transition-colors hover:bg-violet-700 sm:w-auto"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Create Shift</span>
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-theme-surface-border relative -mx-4 mb-6 border-b px-4 sm:mx-0 sm:px-0">
          <nav className="flex scrollbar-thin space-x-1 overflow-x-auto scroll-smooth" aria-label="Scheduling tabs">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex min-h-[44px] items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap transition-colors sm:px-4 ${
                    isActive
                      ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                      : 'text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label}</span>
                </button>
              );
            })}
          </nav>
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
          <div className="mb-6">
            <h2 className="text-theme-text-muted mb-2 text-xs font-semibold">Officer tools</h2>
            <div className="hscroll flex gap-2">
              {adminLinks.map((link) => {
                const Icon = link.icon;
                const isSupply = link.path === '/scheduling/supply/expiring';
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    title={link.description}
                    className="bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover text-theme-text-primary mobile-touch-target inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                    {link.label}
                    {isSupply && supplyCount != null && supplyCount > 0 && (
                      <span className="inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        {supplyCount} expiring
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
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

            {/* Calendar Navigation */}
            <div className="card mb-6 p-3 sm:p-4">
              <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
                <div className="flex items-center space-x-2 sm:space-x-4">
                  <button
                    onClick={() => navigate_(-1)}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 transition-colors"
                    aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <h2 className="text-theme-text-primary text-base font-semibold whitespace-nowrap sm:text-lg">
                    {dateRangeLabel}
                  </h2>
                  <button
                    onClick={() => navigate_(1)}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 transition-colors"
                    aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCurrentDate(new Date())}
                    className="rounded-lg px-3 py-1.5 text-sm text-violet-700 transition-colors hover:bg-violet-500/10 max-md:min-h-[44px] dark:text-violet-400"
                  >
                    Today
                  </button>
                  <div className="bg-theme-input-bg flex rounded-lg p-1" role="tablist" aria-label="Calendar view mode">
                    <button
                      onClick={() => setViewMode('week')}
                      role="tab"
                      aria-selected={viewMode === 'week'}
                      className={`rounded-sm px-3 py-1 text-sm max-md:min-h-[44px] ${viewMode === 'week' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-white'}`}
                    >
                      Week
                    </button>
                    <button
                      onClick={() => setViewMode('month')}
                      role="tab"
                      aria-selected={viewMode === 'month'}
                      className={`rounded-sm px-3 py-1 text-sm max-md:min-h-[44px] ${viewMode === 'month' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-white'}`}
                    >
                      Month
                    </button>
                  </div>
                </div>
              </div>
              {/* What the colours and the ratio mean. Every cell below is
                  shorthand — a unit code, a filled/target ratio and a coloured
                  icon — and none of it is guessable without being told once. */}
              <dl className="border-theme-surface-border text-theme-text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t pt-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
                  <dt className="sr-only">Green tick</dt>
                  <dd>Fully crewed</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <dt className="sr-only">Amber triangle</dt>
                  <dd>Short-staffed</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <dt className="sr-only">Crew count</dt>
                  <dd>Positions filled of the minimum</dd>
                </div>
                <div className="flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" aria-hidden="true" />
                  <dt className="sr-only">Unit code</dt>
                  {/* Not "hover for the name" — half the people reading this are
                      on a phone, which has no hover. */}
                  <dd>Apparatus unit</dd>
                </div>
              </dl>
            </div>

            {/* Error State */}
            {error && (
              <div className="mb-6 flex items-center space-x-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-red-700 dark:text-red-400" />
                <p className="text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="card mb-8 p-12 text-center" role="status" aria-live="polite">
                <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-violet-700 dark:text-violet-400" />
                <p className="text-theme-text-secondary">Loading shifts...</p>
              </div>
            )}

            {/* Week Calendar Grid — desktop: 7-column grid, mobile: stacked list */}
            {!loading && viewMode === 'week' && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="card mb-8 hidden overflow-hidden md:block">
                  <div className="border-theme-surface-border grid grid-cols-7 border-b">
                    {weekDates.map((date, i) => (
                      <div
                        key={i}
                        className={`border-theme-surface-border border-r p-3 text-center last:border-r-0 ${
                          isToday(date) ? 'bg-violet-600/20' : ''
                        }`}
                      >
                        <p className="text-theme-text-muted text-xs uppercase">{DAYS_OF_WEEK[i]}</p>
                        <p
                          className={`mt-1 text-lg font-bold ${
                            isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                          }`}
                        >
                          {date.getDate()}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid min-h-[300px] grid-cols-7">
                    {weekDates.map((date, i) => {
                      const dayShifts = getShiftsForDate(date);
                      return (
                        <div
                          key={i}
                          className={`border-theme-surface-border border-r p-2 last:border-r-0 ${
                            isToday(date) ? 'bg-violet-600/5' : ''
                          }`}
                        >
                          {dayShifts.map((shift) => (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              variant="desktop-week"
                              selected={selectedShift?.id === shift.id}
                              resolvedTheme={resolvedTheme}
                              timezone={tz}
                              onClick={handleShiftClick}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile list view (shown on mobile only) */}
                <div className="mb-8 space-y-2 md:hidden">
                  {weekDates.map((date, i) => {
                    const dayShifts = getShiftsForDate(date);
                    return (
                      <div
                        key={i}
                        className={`card overflow-hidden ${isToday(date) ? 'ring-2 ring-violet-500/30' : ''}`}
                      >
                        <div
                          className={`border-theme-surface-border flex items-center justify-between border-b px-4 py-2 ${
                            isToday(date) ? 'bg-violet-600/10' : 'bg-theme-surface-secondary'
                          }`}
                        >
                          <span
                            className={`text-sm font-semibold ${
                              isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                            }`}
                          >
                            {DAYS_OF_WEEK[i]},{' '}
                            {formatDateCustom(
                              date,
                              {
                                month: 'short',
                                day: 'numeric',
                              },
                              tz
                            )}
                          </span>
                          {isToday(date) && (
                            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs text-white">Today</span>
                          )}
                        </div>
                        <div className="p-3">
                          {dayShifts.length === 0 ? (
                            <p className="text-theme-text-muted py-2 text-center text-sm">No shifts</p>
                          ) : (
                            <div className="space-y-2">
                              {dayShifts.map((shift) => (
                                <ShiftCard
                                  key={shift.id}
                                  shift={shift}
                                  variant="mobile"
                                  selected={selectedShift?.id === shift.id}
                                  resolvedTheme={resolvedTheme}
                                  timezone={tz}
                                  onClick={handleShiftClick}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* Month Calendar Grid — desktop: 7-column grid, mobile: stacked list */}
            {!loading && viewMode === 'month' && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="card mb-8 hidden overflow-hidden md:block">
                  <div className="border-theme-surface-border grid grid-cols-7 border-b">
                    {DAYS_OF_WEEK.map((day) => (
                      <div key={day} className="border-theme-surface-border border-r p-3 text-center last:border-r-0">
                        <p className="text-theme-text-muted text-xs uppercase">{day}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {monthDates.map((date, i) => {
                      const dayShifts = getShiftsForDate(date);
                      const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                      return (
                        <div
                          key={i}
                          className={`border-theme-surface-border min-h-[100px] border-r border-b p-2 last:border-r-0 ${
                            isToday(date) ? 'bg-violet-600/5' : ''
                          } ${!isCurrentMonth ? 'opacity-40' : ''}`}
                        >
                          <p
                            className={`mb-1 text-sm font-medium ${
                              isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                            }`}
                          >
                            {date.getDate()}
                          </p>
                          {dayShifts.map((shift) => (
                            <ShiftCard
                              key={shift.id}
                              shift={shift}
                              variant="compact"
                              selected={selectedShift?.id === shift.id}
                              resolvedTheme={resolvedTheme}
                              timezone={tz}
                              onClick={handleShiftClick}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile: compact mini-calendar + shift list below */}
                <div className="mb-8 space-y-3 md:hidden">
                  {/* Mini month calendar with dot indicators */}
                  <div className="card p-3">
                    <div className="mb-1 grid grid-cols-7 gap-0.5">
                      {DAYS_OF_WEEK.map((d) => (
                        <div
                          key={d}
                          className="text-theme-text-muted py-1 text-center text-[10px] font-medium uppercase"
                        >
                          {d.charAt(0)}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {monthDates.map((date, i) => {
                        const isCurrentMonth = date.getMonth() === currentDate.getMonth();
                        const dayShifts = getShiftsForDate(date);
                        const hasShiftsOnDay = dayShifts.length > 0;
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (hasShiftsOnDay && dayShifts.length > 0) {
                                // Scroll to the day in the list below
                                const el = document.getElementById(`month-mobile-day-${formatDateISO(date)}`);
                                el?.scrollIntoView({
                                  behavior: 'smooth',
                                  block: 'nearest',
                                });
                              }
                            }}
                            className={`relative flex flex-col items-center rounded-md py-1.5 text-xs transition-colors ${
                              !isCurrentMonth ? 'opacity-30' : ''
                            } ${isToday(date) ? 'bg-violet-600 font-bold text-white' : 'text-theme-text-primary'} ${
                              hasShiftsOnDay && !isToday(date) ? 'bg-violet-500/10 font-medium' : ''
                            }`}
                          >
                            {date.getDate()}
                            {hasShiftsOnDay && (
                              <span
                                className={`absolute bottom-0.5 h-1 w-1 rounded-full ${isToday(date) ? 'bg-white' : 'bg-violet-500'}`}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Shift list for days with shifts */}
                  {(() => {
                    const daysWithShifts = monthDates
                      .filter((date) => date.getMonth() === currentDate.getMonth())
                      .filter((date) => getShiftsForDate(date).length > 0);

                    if (daysWithShifts.length === 0) {
                      return (
                        <div className="card p-8 text-center">
                          <CalendarDays className="text-theme-text-muted mx-auto mb-2 h-10 w-10" />
                          <p className="text-theme-text-muted text-sm">No shifts this month</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-2">
                        {daysWithShifts.map((date, i) => {
                          const dayShifts = getShiftsForDate(date);
                          return (
                            <div
                              key={i}
                              id={`month-mobile-day-${formatDateISO(date)}`}
                              className={`card overflow-hidden ${isToday(date) ? 'ring-2 ring-violet-500/30' : ''}`}
                            >
                              <div
                                className={`border-theme-surface-border flex items-center justify-between border-b px-4 py-2 ${
                                  isToday(date) ? 'bg-violet-600/10' : 'bg-theme-surface-secondary'
                                }`}
                              >
                                <span
                                  className={`text-sm font-semibold ${
                                    isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                                  }`}
                                >
                                  {formatDateCustom(
                                    date,
                                    {
                                      weekday: 'short',
                                      month: 'short',
                                      day: 'numeric',
                                    },
                                    tz
                                  )}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-theme-text-muted text-xs">
                                    {dayShifts.length} shift
                                    {dayShifts.length !== 1 ? 's' : ''}
                                  </span>
                                  {isToday(date) && (
                                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-xs text-white">
                                      Today
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="space-y-2 p-3">
                                {dayShifts.map((shift) => (
                                  <ShiftCard
                                    key={shift.id}
                                    shift={shift}
                                    variant="mobile"
                                    selected={selectedShift?.id === shift.id}
                                    resolvedTheme={resolvedTheme}
                                    timezone={tz}
                                    onClick={handleShiftClick}
                                    touchOnly
                                  />
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}

            {/* Empty State */}
            {!loading && !hasShifts && (
              <div className="card p-12 text-center">
                <CalendarDays className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
                <h3 className="text-theme-text-primary mb-2 text-xl font-bold">No Shifts Scheduled</h3>
                <p className="text-theme-text-secondary mb-6">
                  Start building shift schedules and duty rosters for your department.
                </p>
                {canManage && (
                  <button
                    onClick={() => setShowCreateShift(true)}
                    className="inline-flex items-center space-x-2 rounded-lg bg-violet-600 px-6 py-3 text-white transition-colors hover:bg-violet-700"
                  >
                    <Plus className="h-5 w-5" />
                    <span>Create First Shift</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Other Tabs */}
        {activeTab !== 'schedule' && (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === 'my-shifts' && <MyShiftsTab onViewShift={handleShiftClick} />}
            {activeTab === 'open-shifts' && <OpenShiftsTab onViewShift={handleShiftClick} />}
            {activeTab === 'requests' && <RequestsTab />}
            {activeTab === 'equipment-checks' && <MyChecklistsPage />}
            {activeTab === 'shift-reports' && <ShiftReportsTab />}
          </Suspense>
        )}

        {/* Shift Detail Panel */}
        {selectedShift && (
          <Suspense fallback={null}>
            <ShiftDetailPanel
              shift={selectedShift}
              onClose={() => setSelectedShift(null)}
              onRefresh={() => {
                void fetchShifts();
              }}
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
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateShift(false)} aria-hidden="true" />
              <div className="bg-theme-surface-modal border-theme-surface-border relative w-full max-w-lg rounded-lg border shadow-xl">
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

                          {/* Apparatus Selection */}
                          {apparatusList.length > 0 && (
                            <div>
                              <label className="text-theme-text-secondary mb-1 block text-sm font-medium">
                                <span className="flex items-center gap-1.5">
                                  <Truck className="h-4 w-4" /> Apparatus
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
                              >
                                <option value="">No specific apparatus</option>
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
                                        {selected.positions.map((pos, i) => {
                                          const name = typeof pos === 'string' ? pos : pos.position;
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
