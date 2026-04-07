import React, {
  useState,
  useEffect,
  useMemo,
  Suspense,
  useCallback,
} from "react";
import {
  Clock,
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
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
  ExternalLink,
  Truck,
  ChevronDown,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { useTimezone } from "../hooks/useTimezone";
import { useTheme } from "../contexts/ThemeContext";
import { colorCardStyle } from "../utils/colorContrast";
import { formatTime, formatDateCustom, localToUTC } from "../utils/dateFormatting";
import { schedulingService, useSchedulingStore } from "../modules/scheduling";
import type {
  ShiftRecord,
  ShiftTemplateRecord,
} from "../modules/scheduling";
import { resolveTemplatePositions, normalizePositions } from "../modules/scheduling/services/api";
import { lazyWithRetry } from "../utils/lazyWithRetry";
import TimeQuarterHour from "../components/ux/TimeQuarterHour";

// Lazy-loaded tab components
const MyShiftsTab = lazyWithRetry(() => import("./scheduling/MyShiftsTab"));
const OpenShiftsTab = lazyWithRetry(() => import("./scheduling/OpenShiftsTab"));
const RequestsTab = lazyWithRetry(() => import("./scheduling/RequestsTab"));
const ShiftDetailPanel = lazyWithRetry(
  () => import("./scheduling/ShiftDetailPanel"),
);
const ShiftReportsTab = lazyWithRetry(
  () => import("./scheduling/ShiftReportsTab"),
);
const MyChecklistsPage = lazyWithRetry(
  () => import("./scheduling/MyChecklistsPage"),
);

type TabId =
  | "schedule"
  | "my-shifts"
  | "open-shifts"
  | "requests"
  | "equipment-checks"
  | "shift-reports";
type ViewMode = "week" | "month";

// Fallback templates when no backend templates are configured
const FALLBACK_TEMPLATES: ShiftTemplateRecord[] = [
  {
    id: "_day",
    name: "Day Shift",
    start_time_of_day: "07:00",
    end_time_of_day: "19:00",
    duration_hours: 12,
    min_staffing: 4,
    is_default: true,
    is_active: true,
  },
  {
    id: "_night",
    name: "Night Shift",
    start_time_of_day: "19:00",
    end_time_of_day: "07:00",
    duration_hours: 12,
    min_staffing: 4,
    is_default: false,
    is_active: true,
  },
  {
    id: "_24hr",
    name: "24 Hour",
    start_time_of_day: "07:00",
    end_time_of_day: "07:00",
    duration_hours: 24,
    min_staffing: 4,
    is_default: false,
    is_active: true,
  },
];

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const formatDateISO = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** Compute the end date for a shift given its start date and template times. */
const computeEndDate = (
  startDate: string,
  template: ShiftTemplateRecord | undefined,
): string => {
  if (!startDate || !template) return "";
  const [startHour = 0] = template.start_time_of_day.split(":").map(Number);
  const [endHour = 0] = template.end_time_of_day.split(":").map(Number);
  // Same-day shift: end time is after start time and not a 24-hour shift
  if (endHour > startHour && template.duration_hours < 24) {
    return startDate;
  }
  // Overnight or 24-hour shift: end date is the next day
  const nextDay = new Date(startDate + "T12:00:00"); // noon to avoid DST edge cases
  nextDay.setDate(nextDay.getDate() + 1);
  return formatDateISO(nextDay);
};

const getShiftTemplateColor = (shift: ShiftRecord): string | undefined => {
  if (shift.color) return undefined;
  const timePart = shift.start_time.includes("T")
    ? shift.start_time.split("T")[1] ?? ""
    : shift.start_time;
  const startHour = parseInt(timePart.split(":")[0] ?? "0", 10);
  if (startHour >= 5 && startHour < 10)
    return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (startHour >= 10 && startHour < 17)
    return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30";
};

/**
 * Resolve shift card appearance based on staffing status.
 *
 * Fully staffed → green tint + green border (overrides template color).
 * Understaffed → amber tint + amber border (overrides template color).
 * No staffing target configured → falls back to template color.
 */
const getShiftCardAppearance = (
  shift: ShiftRecord,
  resolvedTheme: "light" | "dark" | "high-contrast",
): { className: string; style: React.CSSProperties | undefined } => {
  if (isFullyStaffed(shift)) {
    return {
      className: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
      style: undefined,
    };
  }
  if (isUnderstaffed(shift)) {
    return {
      className: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
      style: undefined,
    };
  }
  return {
    className: getShiftTemplateColor(shift) ?? "",
    style: shift.color ? colorCardStyle(shift.color, resolvedTheme) : undefined,
  };
};

/** Returns the minimum staffing target for a shift, or null if none is configured. */
const getStaffingTarget = (shift: ShiftRecord): number | null => {
  const positions = normalizePositions(
    (shift.apparatus_positions ?? shift.positions) as unknown[] | null,
  );
  const requiredCount = positions.filter(p => p.required).length;
  if (requiredCount > 0) return requiredCount;
  if (shift.min_staffing != null && shift.min_staffing > 0) return shift.min_staffing;
  return null;
};

const isUnderstaffed = (shift: ShiftRecord): boolean => {
  const target = getStaffingTarget(shift);
  return target != null && shift.attendee_count < target;
};

const isFullyStaffed = (shift: ShiftRecord): boolean => {
  const target = getStaffingTarget(shift);
  return target != null && shift.attendee_count >= target;
};

const TAB_CONFIG: {
  id: TabId;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "my-shifts", label: "My Shifts", icon: Clock },
  { id: "open-shifts", label: "Open Shifts", icon: UserPlus },
  { id: "requests", label: "Requests", icon: ArrowLeftRight },
  { id: "equipment-checks", label: "Equipment Checks", icon: ClipboardList },
  { id: "shift-reports", label: "Shift Reports", icon: FileText },
];

const ADMIN_LINKS: {
  label: string;
  path: string;
  icon: React.ElementType;
  description: string;
}[] = [
  { label: "Templates", path: "/scheduling/templates", icon: ClipboardList, description: "Manage shift templates" },
  { label: "Patterns", path: "/scheduling/patterns", icon: Repeat, description: "Configure shift patterns" },
  { label: "Reports", path: "/scheduling/reports", icon: BarChart3, description: "View scheduling reports" },
  { label: "Check Reports", path: "/scheduling/equipment-check-reports", icon: ClipboardList, description: "Equipment compliance" },
  { label: "Settings", path: "/scheduling/settings", icon: Settings, description: "Department settings" },
];

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
    <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
  </div>
);

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const navigate = useNavigate();
  const tz = useTimezone();
  const { resolvedTheme } = useTheme();
  const canManage = checkPermission("scheduling.manage");
  const [searchParams, setSearchParams] = useSearchParams();

  // Shared store — members, templates, apparatus loaded once and cached
  const {
    members: membersList,
    templates: backendTemplates,
    templatesLoaded,
    apparatus: apparatusList,
    summary,
    loadInitialData,
    loadSummary,
  } = useSchedulingStore();

  // Tab state — honour ?tab= query param for deep-linking
  const initialTab = (searchParams.get('tab') || 'schedule') as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(
    ['schedule', 'my-shifts', 'open-shifts', 'requests', 'equipment-checks', 'shift-reports'].includes(initialTab)
      ? initialTab
      : 'schedule'
  );

  // Sync tab state when URL query param changes
  useEffect(() => {
    const tabParam = (searchParams.get('tab') || 'schedule') as TabId;
    const validTabs: TabId[] = [
      'schedule', 'my-shifts', 'open-shifts',
      'requests', 'equipment-checks', 'shift-reports',
    ];
    if (validTabs.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);

  // Calendar state
  const [viewMode, setViewMode] = useState<ViewMode>("week");
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
    return () => { cancelled = true; };
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effective templates: backend if available, otherwise fallbacks
  const effectiveTemplates = useMemo(() => {
    const active = backendTemplates.filter((t) => t.is_active);
    return active.length > 0 ? active : FALLBACK_TEMPLATES;
  }, [backendTemplates]);

  const usingFallbackTemplates =
    backendTemplates.filter((t) => t.is_active).length === 0 && templatesLoaded;

  const defaultTemplate = useMemo(() => {
    return (
      effectiveTemplates.find((t) => t.is_default) || effectiveTemplates[0]
    );
  }, [effectiveTemplates]);

  const [shiftForm, setShiftForm] = useState({
    shiftTemplate: "",
    startDate: "",
    endDate: "",
    notes: "",
    apparatus_id: "",
    shift_officer_id: "",
    customStartTime: "",
    customEndTime: "",
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
    if (viewMode !== "month") return [];
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
    if (viewMode === "month") {
      newDate.setMonth(newDate.getMonth() + direction);
    } else {
      newDate.setDate(newDate.getDate() + direction * 7);
    }
    setCurrentDate(newDate);
  };

  const dateRangeLabel = useMemo(() => {
    if (viewMode === "month") {
      return formatDateCustom(currentDate, {
        month: "long",
        year: "numeric",
      }, tz);
    }
    const start = weekDates[0] ?? currentDate;
    const end = weekDates[6] ?? currentDate;
    const startMonth = formatDateCustom(start, {
      month: "short",
    }, tz);
    const endMonth = formatDateCustom(end, {
      month: "short",
    }, tz);
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
      if (viewMode === "month") {
        fetchedShifts = await schedulingService.getMonthCalendar(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
        );
      } else {
        const weekStartStr = formatDateISO(weekDates[0] ?? currentDate);
        fetchedShifts = await schedulingService.getWeekCalendar(weekStartStr);
      }
      setShifts(fetchedShifts);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to load shifts";
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
    [shiftsByDate],
  );

  const handleCreateShift = async () => {
    if (!shiftForm.startDate) {
      setCreateError("Start date is required.");
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const template =
        effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) ||
        defaultTemplate;
      if (!template) {
        setCreateError(
          "No shift template available. Please create a template first.",
        );
        setCreating(false);
        return;
      }
      const startTime = shiftForm.customStartTime || template.start_time_of_day;
      const endTime = shiftForm.customEndTime || template.end_time_of_day;

      // Use the form's end date (auto-computed or user-overridden)
      const endDate =
        shiftForm.endDate ||
        computeEndDate(shiftForm.startDate, template) ||
        shiftForm.startDate;

      // Convert local times to UTC so the backend stores correct values
      const startDateTime = localToUTC(`${shiftForm.startDate}T${startTime}`, tz);
      const endDateTime = localToUTC(`${endDate}T${endTime}`, tz);

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
        shiftTemplate: defaultTemplate?.id || "",
        startDate: "",
        endDate: "",
        notes: "",
        apparatus_id: "",
        shift_officer_id: "",
        customStartTime: "",
        customEndTime: "",
      });
      setShowCreateShift(false);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create shift";
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const handleShiftClick = (shift: ShiftRecord) => {
    setSelectedShift(shift);
  };

  const hasShifts = shifts.length > 0;

  const visibleTabs = TAB_CONFIG;

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="bg-violet-600 rounded-lg p-2">
              <Clock className="w-6 h-6 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-xl sm:text-2xl font-bold">
                Scheduling & Shifts
              </h1>
              <p className="text-theme-text-muted text-sm">
                Manage schedules, sign up for shifts, and handle trades
              </p>
            </div>
          </div>
          {canManage && activeTab === "schedule" && (
            <button
              onClick={() => setShowCreateShift(true)}
              className="flex items-center justify-center space-x-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors w-full sm:w-auto"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Create Shift</span>
            </button>
          )}
        </div>

        {/* Tab Navigation */}
        <div className="border-b border-theme-surface-border mb-6 -mx-4 px-4 sm:mx-0 sm:px-0 relative">
          <nav
            className="flex space-x-1 overflow-x-auto scrollbar-thin scroll-smooth"
            aria-label="Scheduling tabs"
          >
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px] ${
                    isActive
                      ? "border-violet-600 text-violet-600 dark:text-violet-400"
                      : "border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label}</span>
                </button>
              );
            })}
          </nav>
          {/* Scroll fade hint on right edge (mobile) */}
          <div
            className="absolute right-0 top-0 bottom-0 w-8 bg-linear-to-l from-theme-bg to-transparent pointer-events-none sm:hidden"
            aria-hidden="true"
          />
        </div>

        {/* Tab Content */}
        {activeTab === "schedule" && (
          <>
            {/* Summary Stats */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">
                    Total Shifts
                  </p>
                  <p className="text-theme-text-primary text-xl sm:text-2xl font-bold">
                    {summary.total_shifts}
                  </p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">
                    This Week
                  </p>
                  <p className="text-theme-text-primary text-xl sm:text-2xl font-bold">
                    {summary.shifts_this_week}
                  </p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">
                    This Month
                  </p>
                  <p className="text-theme-text-primary text-xl sm:text-2xl font-bold">
                    {summary.shifts_this_month}
                  </p>
                </div>
                <div className="card p-3 sm:p-4">
                  <p className="text-theme-text-muted text-xs sm:text-sm">
                    Hours This Month
                  </p>
                  <p className="text-theme-text-primary text-xl sm:text-2xl font-bold">
                    {summary.total_hours_this_month}
                  </p>
                </div>
              </div>
            )}

            {/* Calendar Navigation */}
            <div className="card mb-6 p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center space-x-2 sm:space-x-4">
                  <button
                    onClick={() => navigate_(-1)}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={
                      viewMode === "month" ? "Previous month" : "Previous week"
                    }
                  >
                    <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <h2 className="text-theme-text-primary font-semibold text-base sm:text-lg whitespace-nowrap">
                    {dateRangeLabel}
                  </h2>
                  <button
                    onClick={() => navigate_(1)}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={
                      viewMode === "month" ? "Next month" : "Next week"
                    }
                  >
                    <ChevronRight className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setCurrentDate(new Date())}
                    className="px-3 py-1.5 text-sm text-violet-700 dark:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
                  >
                    Today
                  </button>
                  <div
                    className="flex bg-theme-input-bg rounded-lg p-1"
                    role="tablist"
                    aria-label="Calendar view mode"
                  >
                    <button
                      onClick={() => setViewMode("week")}
                      role="tab"
                      aria-selected={viewMode === "week"}
                      className={`px-3 py-1 rounded-sm text-sm ${viewMode === "week" ? "bg-violet-600 text-white" : "text-theme-text-muted hover:text-white"}`}
                    >
                      Week
                    </button>
                    <button
                      onClick={() => setViewMode("month")}
                      role="tab"
                      aria-selected={viewMode === "month"}
                      className={`px-3 py-1 rounded-sm text-sm ${viewMode === "month" ? "bg-violet-600 text-white" : "text-theme-text-muted hover:text-white"}`}
                    >
                      Month
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Error State */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-6 flex items-center space-x-3">
                <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" />
                <p className="text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="card mb-8 p-12 text-center" role="status" aria-live="polite">
                <Loader2 className="w-8 h-8 text-violet-700 dark:text-violet-400 mx-auto mb-3 animate-spin" />
                <p className="text-theme-text-secondary">Loading shifts...</p>
              </div>
            )}

            {/* Week Calendar Grid — desktop: 7-column grid, mobile: stacked list */}
            {!loading && viewMode === "week" && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="card hidden mb-8 md:block overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-theme-surface-border">
                    {weekDates.map((date, i) => (
                      <div
                        key={i}
                        className={`p-3 text-center border-r border-theme-surface-border last:border-r-0 ${
                          isToday(date) ? "bg-violet-600/20" : ""
                        }`}
                      >
                        <p className="text-theme-text-muted text-xs uppercase">
                          {DAYS_OF_WEEK[i]}
                        </p>
                        <p
                          className={`text-lg font-bold mt-1 ${
                            isToday(date)
                              ? "text-violet-700 dark:text-violet-400"
                              : "text-theme-text-primary"
                          }`}
                        >
                          {date.getDate()}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 min-h-[300px]">
                    {weekDates.map((date, i) => {
                      const dayShifts = getShiftsForDate(date);
                      return (
                        <div
                          key={i}
                          className={`p-2 border-r border-theme-surface-border last:border-r-0 ${
                            isToday(date) ? "bg-violet-600/5" : ""
                          }`}
                        >
                          {dayShifts.map((shift) => {
                            const card = getShiftCardAppearance(shift, resolvedTheme);
                            return (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-2 p-2 rounded-lg border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${selectedShift?.id === shift.id ? 'ring-2 ring-violet-500' : ''} ${card.className}`}
                              style={card.style}
                            >
                              <p className="font-medium truncate">
                                {formatTime(shift.start_time, tz)}
                                {shift.end_time
                                  ? ` - ${formatTime(shift.end_time, tz)}`
                                  : ""}
                              </p>
                              {shift.notes && (
                                <p className="mt-1 opacity-80 line-clamp-2">
                                  {shift.notes}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {isUnderstaffed(shift) ? (
                                  <span
                                    className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5"
                                    title={`Understaffed: ${shift.attendee_count}/${getStaffingTarget(shift)} filled`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                  </span>
                                ) : isFullyStaffed(shift) ? (
                                  <span
                                    className="text-green-600 dark:text-green-400 flex items-center gap-0.5"
                                    title="Fully staffed"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                  </span>
                                ) : null}
                                <span className="opacity-70 flex items-center gap-0.5">
                                  <Users className="w-3 h-3" />{" "}
                                  {shift.attendee_count}
                                  {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`}
                                </span>
                                {shift.apparatus_unit_number && (
                                  <span className="opacity-70 flex items-center gap-0.5">
                                    <Truck className="w-3 h-3" />{" "}
                                    {shift.apparatus_unit_number}
                                  </span>
                                )}
                              </div>
                            </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile list view (shown on mobile only) */}
                <div className="md:hidden space-y-2 mb-8">
                  {weekDates.map((date, i) => {
                    const dayShifts = getShiftsForDate(date);
                    return (
                      <div
                        key={i}
                        className={`card overflow-hidden ${
 isToday(date) ? "ring-2 ring-violet-500/30" : ""
 }`}
                      >
                        <div
                          className={`px-4 py-2 border-b border-theme-surface-border flex items-center justify-between ${
                            isToday(date)
                              ? "bg-violet-600/10"
                              : "bg-theme-surface-secondary"
                          }`}
                        >
                          <span
                            className={`text-sm font-semibold ${
                              isToday(date)
                                ? "text-violet-700 dark:text-violet-400"
                                : "text-theme-text-primary"
                            }`}
                          >
                            {DAYS_OF_WEEK[i]},{" "}
                            {formatDateCustom(date, {
                              month: "short",
                              day: "numeric",
                            }, tz)}
                          </span>
                          {isToday(date) && (
                            <span className="text-xs px-2 py-0.5 bg-violet-600 text-white rounded-full">
                              Today
                            </span>
                          )}
                        </div>
                        <div className="p-3">
                          {dayShifts.length === 0 ? (
                            <p className="text-theme-text-muted text-sm text-center py-2">
                              No shifts
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {dayShifts.map((shift) => {
                                const card = getShiftCardAppearance(shift, resolvedTheme);
                                return (
                                <button
                                  key={shift.id}
                                  onClick={() => handleShiftClick(shift)}
                                  className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${selectedShift?.id === shift.id ? 'ring-2 ring-violet-500' : ''} ${card.className}`}
                                  style={card.style}
                                >
                                  <p className="font-medium">
                                    {formatTime(shift.start_time, tz)}
                                    {shift.end_time
                                      ? ` - ${formatTime(shift.end_time, tz)}`
                                      : ""}
                                  </p>
                                  {shift.notes && (
                                    <p className="mt-1 opacity-80 line-clamp-2">
                                      {shift.notes}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    {isUnderstaffed(shift) ? (
                                      <span
                                        className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-xs"
                                        title={`Understaffed: ${shift.attendee_count}/${getStaffingTarget(shift)} filled`}
                                      >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                      </span>
                                    ) : isFullyStaffed(shift) ? (
                                      <span
                                        className="text-green-600 dark:text-green-400 flex items-center gap-1 text-xs"
                                        title="Fully staffed"
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                      </span>
                                    ) : null}
                                    <span className="opacity-70 flex items-center gap-1 text-xs">
                                      <Users className="w-3.5 h-3.5" />{" "}
                                      {shift.attendee_count}
                                      {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`} staff
                                    </span>
                                    {shift.apparatus_unit_number && (
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Truck className="w-3.5 h-3.5" />{" "}
                                        {shift.apparatus_unit_number}
                                      </span>
                                    )}
                                  </div>
                                </button>
                                );
                              })}
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
            {!loading && viewMode === "month" && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="card hidden mb-8 md:block overflow-hidden">
                  <div className="grid grid-cols-7 border-b border-theme-surface-border">
                    {DAYS_OF_WEEK.map((day) => (
                      <div
                        key={day}
                        className="p-3 text-center border-r border-theme-surface-border last:border-r-0"
                      >
                        <p className="text-theme-text-muted text-xs uppercase">
                          {day}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {monthDates.map((date, i) => {
                      const dayShifts = getShiftsForDate(date);
                      const isCurrentMonth =
                        date.getMonth() === currentDate.getMonth();
                      return (
                        <div
                          key={i}
                          className={`p-2 border-r border-b border-theme-surface-border last:border-r-0 min-h-[100px] ${
                            isToday(date) ? "bg-violet-600/5" : ""
                          } ${!isCurrentMonth ? "opacity-40" : ""}`}
                        >
                          <p
                            className={`text-sm font-medium mb-1 ${
                              isToday(date)
                                ? "text-violet-700 dark:text-violet-400"
                                : "text-theme-text-primary"
                            }`}
                          >
                            {date.getDate()}
                          </p>
                          {dayShifts.map((shift) => {
                            const card = getShiftCardAppearance(shift, resolvedTheme);
                            return (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-1 px-1.5 py-1 rounded-sm border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${selectedShift?.id === shift.id ? 'ring-2 ring-violet-500' : ''} ${card.className}`}
                              style={card.style}
                            >
                              <p className="font-medium truncate">
                                {isUnderstaffed(shift) ? (
                                  <AlertTriangle className="w-3 h-3 inline text-amber-600 dark:text-amber-400 mr-0.5" />
                                ) : isFullyStaffed(shift) ? (
                                  <CheckCircle2 className="w-3 h-3 inline text-green-600 dark:text-green-400 mr-0.5" />
                                ) : null}
                                {formatTime(shift.start_time, tz)}
                                {shift.apparatus_unit_number && (
                                  <span className="ml-1 opacity-70">
                                    {shift.apparatus_unit_number}
                                  </span>
                                )}
                                <span className="ml-1 opacity-70">
                                  ({shift.attendee_count}
                                  {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`})
                                </span>
                              </p>
                            </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile: compact mini-calendar + shift list below */}
                <div className="md:hidden mb-8 space-y-3">
                  {/* Mini month calendar with dot indicators */}
                  <div className="card p-3">
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                      {DAYS_OF_WEEK.map((d) => (
                        <div
                          key={d}
                          className="text-center text-[10px] font-medium text-theme-text-muted uppercase py-1"
                        >
                          {d.charAt(0)}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {monthDates.map((date, i) => {
                        const isCurrentMonth =
                          date.getMonth() === currentDate.getMonth();
                        const dayShifts = getShiftsForDate(date);
                        const hasShiftsOnDay = dayShifts.length > 0;
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (hasShiftsOnDay && dayShifts.length > 0) {
                                // Scroll to the day in the list below
                                const el = document.getElementById(
                                  `month-mobile-day-${formatDateISO(date)}`,
                                );
                                el?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                              }
                            }}
                            className={`relative flex flex-col items-center py-1.5 rounded-md text-xs transition-colors ${
                              !isCurrentMonth ? "opacity-30" : ""
                            } ${isToday(date) ? "bg-violet-600 text-white font-bold" : "text-theme-text-primary"} ${
                              hasShiftsOnDay && !isToday(date)
                                ? "bg-violet-500/10 font-medium"
                                : ""
                            }`}
                          >
                            {date.getDate()}
                            {hasShiftsOnDay && (
                              <span
                                className={`absolute bottom-0.5 w-1 h-1 rounded-full ${isToday(date) ? "bg-white" : "bg-violet-500"}`}
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
                      .filter(
                        (date) => date.getMonth() === currentDate.getMonth(),
                      )
                      .filter((date) => getShiftsForDate(date).length > 0);

                    if (daysWithShifts.length === 0) {
                      return (
                        <div className="card p-8 text-center">
                          <CalendarDays className="w-10 h-10 text-theme-text-muted mx-auto mb-2" />
                          <p className="text-theme-text-muted text-sm">
                            No shifts this month
                          </p>
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
                              className={`card overflow-hidden ${
 isToday(date) ? "ring-2 ring-violet-500/30" : ""
 }`}
                            >
                              <div
                                className={`px-4 py-2 border-b border-theme-surface-border flex items-center justify-between ${
                                  isToday(date)
                                    ? "bg-violet-600/10"
                                    : "bg-theme-surface-secondary"
                                }`}
                              >
                                <span
                                  className={`text-sm font-semibold ${
                                    isToday(date)
                                      ? "text-violet-700 dark:text-violet-400"
                                      : "text-theme-text-primary"
                                  }`}
                                >
                                  {formatDateCustom(date, {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                  }, tz)}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-theme-text-muted">
                                    {dayShifts.length} shift
                                    {dayShifts.length !== 1 ? "s" : ""}
                                  </span>
                                  {isToday(date) && (
                                    <span className="text-xs px-2 py-0.5 bg-violet-600 text-white rounded-full">
                                      Today
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="p-3 space-y-2">
                                {dayShifts.map((shift) => {
                                  const card = getShiftCardAppearance(shift, resolvedTheme);
                                  return (
                                  <button
                                    key={shift.id}
                                    onClick={() => handleShiftClick(shift)}
                                    className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer active:ring-2 active:ring-violet-500/50 transition-all ${selectedShift?.id === shift.id ? 'ring-2 ring-violet-500' : ''} ${card.className}`}
                                    style={card.style}
                                  >
                                    <p className="font-medium">
                                      {formatTime(shift.start_time, tz)}
                                      {shift.end_time
                                        ? ` - ${formatTime(shift.end_time, tz)}`
                                        : ""}
                                    </p>
                                    {shift.notes && (
                                      <p className="mt-1 opacity-80 line-clamp-2">
                                        {shift.notes}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1.5">
                                      {isUnderstaffed(shift) ? (
                                        <span
                                          className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-xs"
                                          title={`Understaffed: ${shift.attendee_count}/${getStaffingTarget(shift)} filled`}
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5" />
                                        </span>
                                      ) : isFullyStaffed(shift) ? (
                                        <span
                                          className="text-green-600 dark:text-green-400 flex items-center gap-1 text-xs"
                                          title="Fully staffed"
                                        >
                                          <CheckCircle2 className="w-3.5 h-3.5" />
                                        </span>
                                      ) : null}
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Users className="w-3.5 h-3.5" />{" "}
                                        {shift.attendee_count}
                                        {getStaffingTarget(shift) != null && `/${getStaffingTarget(shift)}`} staff
                                      </span>
                                      {shift.apparatus_unit_number && (
                                        <span className="opacity-70 flex items-center gap-1 text-xs">
                                          <Truck className="w-3.5 h-3.5" />{" "}
                                          {shift.apparatus_unit_number}
                                        </span>
                                      )}
                                    </div>
                                  </button>
                                  );
                                })}
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
                <CalendarDays className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">
                  No Shifts Scheduled
                </h3>
                <p className="text-theme-text-secondary mb-6">
                  Start building shift schedules and duty rosters for your
                  department.
                </p>
                {canManage && (
                  <button
                    onClick={() => setShowCreateShift(true)}
                    className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
                  >
                    <Plus className="w-5 h-5" />
                    <span>Create First Shift</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* Other Tabs */}
        {activeTab !== "schedule" && (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === "my-shifts" && (
              <MyShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === "open-shifts" && (
              <OpenShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === "requests" && <RequestsTab />}
            {activeTab === "equipment-checks" && <MyChecklistsPage />}
            {activeTab === "shift-reports" && <ShiftReportsTab />}
          </Suspense>
        )}

        {/* Admin Quick Links */}
        {canManage && (
          <div className="mt-8 border-t border-theme-surface-border pt-6">
            <h2 className="text-sm font-semibold text-theme-text-muted uppercase tracking-wider mb-3">
              Administration
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {ADMIN_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className="flex items-center gap-3 p-3 bg-theme-surface border border-theme-surface-border rounded-xl hover:bg-theme-surface-hover transition-colors group"
                  >
                    <Icon className="w-5 h-5 text-violet-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-theme-text-primary truncate">
                        {link.label}
                      </p>
                      <p className="text-xs text-theme-text-muted truncate hidden sm:block">
                        {link.description}
                      </p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-theme-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </Link>
                );
              })}
            </div>
          </div>
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
              if (e.key === "Escape") setShowCreateShift(false);
            }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div
                className="fixed inset-0 bg-black/60"
                onClick={() => setShowCreateShift(false)}
                aria-hidden="true"
              />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3
                      id="create-schedule-title"
                      className="text-lg font-medium text-theme-text-primary"
                    >
                      Create Shift
                    </h3>
                    <button
                      onClick={() => setShowCreateShift(false)}
                      className="text-theme-text-muted hover:text-theme-text-primary"
                      aria-label="Close dialog"
                    >
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Shift Template
                      </label>
                      {effectiveTemplates.length > 5 && (
                        <input
                          type="text"
                          placeholder="Search templates..."
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          className="form-input focus:ring-violet-500 mb-2 text-sm"
                        />
                      )}
                      <select
                        value={shiftForm.shiftTemplate}
                        onChange={(e) => {
                          const tmpl = effectiveTemplates.find(
                            (t) => t.id === e.target.value,
                          );
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
                            ? effectiveTemplates.filter(t =>
                                t.name.toLowerCase().includes(q) ||
                                (t.apparatus_type ?? '').toLowerCase().includes(q) ||
                                (t.category ?? '').toLowerCase().includes(q)
                              )
                            : effectiveTemplates;

                          const standard = filtered.filter(
                            (t) => !t.category || t.category === "standard",
                          );
                          const specialty = filtered.filter(
                            (t) => t.category === "specialty",
                          );
                          const event = filtered.filter(
                            (t) => t.category === "event",
                          );
                          return (
                            <>
                              {standard.length > 0 && (
                                <optgroup label="Standard Shifts">
                                  {standard.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                      {t.apparatus_type
                                        ? ` — ${t.apparatus_type}`
                                        : ""}{" "}
                                      ({t.start_time_of_day} -{" "}
                                      {t.end_time_of_day})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {specialty.length > 0 && (
                                <optgroup label="Specialty Vehicle">
                                  {specialty.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({t.start_time_of_day} -{" "}
                                      {t.end_time_of_day})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {event.length > 0 && (
                                <optgroup label="Event / Special">
                                  {event.map((t) => (
                                    <option key={t.id} value={t.id}>
                                      {t.name} ({t.start_time_of_day} -{" "}
                                      {t.end_time_of_day})
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {standard.length === 0 &&
                                specialty.length === 0 &&
                                event.length === 0 && filtered.length > 0 &&
                                filtered.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.start_time_of_day} -{" "}
                                    {t.end_time_of_day})
                                  </option>
                                ))}
                              {filtered.length === 0 && (
                                <option value="" disabled>No templates match &ldquo;{templateSearch}&rdquo;</option>
                              )}
                            </>
                          );
                        })()}
                      </select>
                      {/* Template info preview */}
                      {(() => {
                        const tmpl =
                          effectiveTemplates.find(
                            (t) => t.id === shiftForm.shiftTemplate,
                          ) || defaultTemplate;
                        if (!tmpl) return null;
                        const flatPositions = resolveTemplatePositions(tmpl.positions);
                        const hasPositions = flatPositions.length > 0;
                        const catLabel =
                          tmpl.category === "specialty"
                            ? "Specialty"
                            : tmpl.category === "event"
                              ? "Event"
                              : null;
                        return (
                          <div className="mt-2 p-2.5 bg-theme-surface-hover/50 rounded-lg space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2">
                                <span className="text-theme-text-muted">
                                  Duration:{" "}
                                  <span className="text-theme-text-primary font-medium">
                                    {tmpl.duration_hours}h
                                  </span>
                                </span>
                                {catLabel && (
                                  <span
                                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                                      tmpl.category === "specialty"
                                        ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
                                        : "bg-purple-500/10 text-purple-700 dark:text-purple-400"
                                    }`}
                                  >
                                    {catLabel}
                                  </span>
                                )}
                              </div>
                              <span className="text-theme-text-muted">
                                Min staffing:{" "}
                                <span className="text-theme-text-primary font-medium">
                                  {tmpl.min_staffing}
                                </span>
                              </span>
                            </div>
                            {tmpl.apparatus_type && (
                              <p className="text-xs text-theme-text-muted flex items-center gap-1">
                                <Truck className="w-3 h-3" /> Vehicle type:{" "}
                                <span className="text-theme-text-primary capitalize font-medium">
                                  {tmpl.apparatus_type}
                                </span>
                              </p>
                            )}
                            {hasPositions && (
                              <div>
                                <p className="text-xs text-theme-text-muted mb-1">
                                  Required positions:
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {flatPositions.map((slot, i) => (
                                    <span
                                      key={i}
                                      className={`px-2 py-0.5 text-[10px] rounded-sm capitalize font-medium ${slot.required ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300' : 'bg-theme-surface-hover text-theme-text-muted'}`}
                                    >
                                      {slot.position}{!slot.required && ' (opt)'}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      {usingFallbackTemplates && (
                        <p className="mt-1.5 text-xs text-theme-text-muted">
                          Using default templates.{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setShowCreateShift(false);
                              void navigate("/scheduling/templates");
                            }}
                            className="text-violet-600 dark:text-violet-400 hover:underline"
                          >
                            Configure your own
                          </button>{" "}
                          on the Templates page.
                        </p>
                      )}
                    </div>

                    {/* Start / End Date — always visible */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                          Start Date *
                        </label>
                        <input
                          type="date"
                          value={shiftForm.startDate}
                          onChange={(e) => {
                            const newStart = e.target.value;
                            const tmpl =
                              effectiveTemplates.find(
                                (t) => t.id === shiftForm.shiftTemplate,
                              ) || defaultTemplate;
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
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                          End Date
                        </label>
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
                              effectiveTemplates.find(
                                (t) => t.id === shiftForm.shiftTemplate,
                              ) || defaultTemplate;
                            if (!tmpl) return null;
                            const sameDay =
                              shiftForm.startDate === shiftForm.endDate;
                            return (
                              <p className="text-xs text-theme-text-muted mt-1">
                                {tmpl.start_time_of_day} &rarr;{" "}
                                {tmpl.end_time_of_day} (
                                {sameDay ? "same day" : "next day"})
                              </p>
                            );
                          })()}
                      </div>
                    </div>

                    {/* Auto-generated shift label preview */}
                    {(() => {
                      const tmpl =
                        effectiveTemplates.find(
                          (t) => t.id === shiftForm.shiftTemplate,
                        ) || defaultTemplate;
                      const apparatus = apparatusList.find(
                        (a) => a.id === shiftForm.apparatus_id,
                      );
                      if (!tmpl) return null;
                      const suffix =
                        tmpl.duration_hours >= 24
                          ? "24"
                          : tmpl.start_time_of_day < tmpl.end_time_of_day
                            ? "DS"
                            : "NS";
                      const label = apparatus
                        ? `${apparatus.unit_number} ${suffix}`
                        : `${tmpl.name}`;
                      return (
                        <div className="flex items-center gap-2 p-2.5 bg-theme-surface-hover/50 rounded-lg border border-theme-surface-border">
                          <span className="text-xs text-theme-text-muted">
                            Shift label:
                          </span>
                          <span className="text-sm font-semibold text-theme-text-primary">
                            {label}
                          </span>
                        </div>
                      );
                    })()}

                    {/* Collapsible additional options */}
                    <div className="border border-theme-surface-border rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                        className="w-full flex items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <Settings className="w-3.5 h-3.5" />
                          Additional Options
                          {(shiftForm.apparatus_id || shiftForm.shift_officer_id || shiftForm.customStartTime || shiftForm.customEndTime || shiftForm.notes) && (
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                          )}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-theme-text-muted transition-transform duration-200 ${showAdvancedOptions ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                      {showAdvancedOptions && (
                        <div className="px-4 pb-4 pt-1 space-y-4 border-t border-theme-surface-border">
                          {/* Custom Time Override */}
                          <div>
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                              <span className="flex items-center gap-1.5">
                                <Clock className="w-4 h-4" /> Custom Times
                              </span>
                            </label>
                            <p className="text-xs text-theme-text-muted mb-2">Override the template times for this shift</p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs text-theme-text-muted mb-1">Start Time</label>
                                <TimeQuarterHour
                                  value={shiftForm.customStartTime}
                                  onChange={(e) => setShiftForm({ ...shiftForm, customStartTime: e.target.value })}
                                  placeholder={(() => {
                                    const tmpl = effectiveTemplates.find((t) => t.id === shiftForm.shiftTemplate) || defaultTemplate;
                                    return tmpl?.start_time_of_day || '';
                                  })()}
                                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500"
                                />
                              </div>
                              <div>
                                <label className="block text-xs text-theme-text-muted mb-1">End Time</label>
                                <TimeQuarterHour
                                  value={shiftForm.customEndTime}
                                  onChange={(e) => setShiftForm({ ...shiftForm, customEndTime: e.target.value })}
                                  className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-hidden focus:ring-2 focus:ring-violet-500"
                                />
                              </div>
                            </div>
                            {(shiftForm.customStartTime || shiftForm.customEndTime) && (
                              <button
                                type="button"
                                onClick={() => setShiftForm({ ...shiftForm, customStartTime: "", customEndTime: "" })}
                                className="mt-1 text-xs text-theme-text-muted hover:text-violet-500"
                              >
                                Reset to template times
                              </button>
                            )}
                          </div>

                          {/* Apparatus Selection */}
                          {apparatusList.length > 0 && (
                            <div>
                              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                                <span className="flex items-center gap-1.5">
                                  <Truck className="w-4 h-4" /> Apparatus
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
                                const selected = apparatusList.find(
                                  (a) => a.id === shiftForm.apparatus_id,
                                );
                                if (
                                  selected?.positions &&
                                  selected.positions.length > 0
                                ) {
                                  return (
                                    <div className="mt-2 p-2.5 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                                      <p className="text-xs font-medium text-violet-700 dark:text-violet-400 mb-1.5">
                                        Positions on {selected.unit_number}:
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {selected.positions.map((pos, i) => {
                                          const name = typeof pos === 'string' ? pos : pos.position;
                                          return (
                                            <span
                                              key={i}
                                              className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-sm capitalize"
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
                                    <p className="text-xs text-theme-text-muted mt-1">
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
                              <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                                <span className="flex items-center gap-1.5">
                                  <Users className="w-4 h-4" /> Shift Officer
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
                            <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Notes
                            </label>
                            <textarea
                              value={shiftForm.notes}
                              onChange={(e) =>
                                setShiftForm({ ...shiftForm, notes: e.target.value })
                              }
                              rows={2}
                              className="form-input focus:ring-violet-500 resize-none"
                              placeholder="Optional notes for this shift..."
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    {createError && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <div className="flex items-start space-x-2">
                          <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 shrink-0" />
                          <p className="text-red-700 dark:text-red-300 text-sm">
                            {createError}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => {
                      setShowCreateShift(false);
                      setCreateError(null);
                    }}
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      void handleCreateShift();
                    }}
                    disabled={creating || !shiftForm.startDate}
                    className={`px-4 py-2 rounded-lg transition-colors inline-flex items-center space-x-2 ${
                      creating || !shiftForm.startDate
                        ? "bg-violet-600/50 text-white/50 cursor-not-allowed"
                        : "bg-violet-600 hover:bg-violet-700 text-white"
                    }`}
                  >
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>{creating ? "Creating..." : "Create Shift"}</span>
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
