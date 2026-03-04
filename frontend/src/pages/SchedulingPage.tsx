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
  X,
  Loader2,
  Users,
  UserPlus,
  ArrowLeftRight,
  ClipboardList,
  BarChart3,
  Truck,
  Settings,
  Repeat,
  FileText,
} from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { useTimezone } from "../hooks/useTimezone";
import { formatTime } from "../utils/dateFormatting";
import { schedulingService, useSchedulingStore } from "../modules/scheduling";
import type {
  ShiftRecord,
  ShiftTemplateRecord,
} from "../modules/scheduling";
import { lazyWithRetry } from "../utils/lazyWithRetry";

// Lazy-loaded tab components
const MyShiftsTab = lazyWithRetry(() => import("./scheduling/MyShiftsTab"));
const OpenShiftsTab = lazyWithRetry(() => import("./scheduling/OpenShiftsTab"));
const RequestsTab = lazyWithRetry(() => import("./scheduling/RequestsTab"));
const ShiftTemplatesPage = lazyWithRetry(() => import("./ShiftTemplatesPage"));
const SchedulingReportsPage = lazyWithRetry(
  () => import("./SchedulingReportsPage"),
);
const ShiftDetailPanel = lazyWithRetry(
  () => import("./scheduling/ShiftDetailPanel"),
);
const PatternsTab = lazyWithRetry(() => import("./scheduling/PatternsTab"));
const ShiftReportsTab = lazyWithRetry(
  () => import("./scheduling/ShiftReportsTab"),
);

type TabId =
  | "schedule"
  | "my-shifts"
  | "open-shifts"
  | "requests"
  | "templates"
  | "patterns"
  | "shift-reports"
  | "reports"
  | "settings";
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

/** Map a hex color to Tailwind-compatible inline styles for shift cards. */
const hexColorStyle = (hex: string): React.CSSProperties => ({
  backgroundColor: `${hex}18`,
  borderColor: `${hex}4D`,
  color: hex,
});

const getShiftTemplateColor = (shift: ShiftRecord): string | undefined => {
  // If the shift carries a template color, use inline styles instead (via getShiftStyle)
  if (shift.color) return undefined;
  const startHour = parseInt(shift.start_time.split(":")[0] ?? "0", 10);
  if (startHour >= 5 && startHour < 10)
    return "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (startHour >= 10 && startHour < 17)
    return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30";
  return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30";
};

const getShiftStyle = (shift: ShiftRecord): React.CSSProperties | undefined =>
  shift.color ? hexColorStyle(shift.color) : undefined;

const isUnderstaffed = (shift: ShiftRecord): boolean =>
  shift.min_staffing != null &&
  shift.min_staffing > 0 &&
  shift.attendee_count < shift.min_staffing;

const TAB_CONFIG: {
  id: TabId;
  label: string;
  icon: React.ElementType;
  adminOnly?: boolean;
}[] = [
  { id: "schedule", label: "Schedule", icon: CalendarDays },
  { id: "my-shifts", label: "My Shifts", icon: Clock },
  { id: "open-shifts", label: "Open Shifts", icon: UserPlus },
  { id: "requests", label: "Requests", icon: ArrowLeftRight },
  { id: "templates", label: "Templates", icon: ClipboardList, adminOnly: true },
  { id: "patterns", label: "Patterns", icon: Repeat, adminOnly: true },
  { id: "shift-reports", label: "Shift Reports", icon: FileText },
  { id: "reports", label: "Reports", icon: BarChart3, adminOnly: true },
  { id: "settings", label: "Settings", icon: Settings, adminOnly: true },
];

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
  </div>
);

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission("scheduling.manage");

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

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>("schedule");

  // Calendar state
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Shift detail panel
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

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
      return currentDate.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: tz,
      });
    }
    const start = weekDates[0] ?? currentDate;
    const end = weekDates[6] ?? currentDate;
    const startMonth = start.toLocaleString("en-US", {
      month: "short",
      timeZone: tz,
    });
    const endMonth = end.toLocaleString("en-US", {
      month: "short",
      timeZone: tz,
    });
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
      const startDateTime = `${shiftForm.startDate}T${startTime}:00`;

      // Use the form's end date (auto-computed or user-overridden)
      const endDate =
        shiftForm.endDate ||
        computeEndDate(shiftForm.startDate, template) ||
        shiftForm.startDate;
      const endDateTime = `${endDate}T${endTime}:00`;

      await schedulingService.createShift({
        shift_date: shiftForm.startDate,
        start_time: startDateTime,
        end_time: endDateTime,
        ...(shiftForm.notes ? { notes: shiftForm.notes } : {}),
        ...(shiftForm.apparatus_id ? { apparatus_id: shiftForm.apparatus_id } : {}),
        ...(shiftForm.shift_officer_id ? { shift_officer_id: shiftForm.shift_officer_id } : {}),
        ...(template.color ? { color: template.color } : {}),
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

  const visibleTabs = useMemo(
    () => TAB_CONFIG.filter((t) => !t.adminOnly || canManage),
    [canManage],
  );

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
              <div className="card mb-8 p-12 text-center">
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
                          {dayShifts.map((shift) => (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-2 p-2 rounded-lg border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift) ?? ""}`}
                              style={getShiftStyle(shift)}
                            >
                              <p className="font-medium truncate">
                                {formatTime(shift.start_time, tz)}
                                {shift.end_time
                                  ? ` - ${formatTime(shift.end_time, tz)}`
                                  : ""}
                              </p>
                              {shift.notes && (
                                <p className="mt-1 opacity-80 truncate">
                                  {shift.notes}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {isUnderstaffed(shift) && (
                                  <span
                                    className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5"
                                    title={`Needs ${shift.min_staffing} staff`}
                                  >
                                    <AlertTriangle className="w-3 h-3" />
                                  </span>
                                )}
                                <span className="opacity-70 flex items-center gap-0.5">
                                  <Users className="w-3 h-3" />{" "}
                                  {shift.attendee_count}
                                </span>
                                {shift.apparatus_unit_number && (
                                  <span className="opacity-70 flex items-center gap-0.5">
                                    <Truck className="w-3 h-3" />{" "}
                                    {shift.apparatus_unit_number}
                                  </span>
                                )}
                              </div>
                            </button>
                          ))}
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
                            {date.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              timeZone: tz,
                            })}
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
                              {dayShifts.map((shift) => (
                                <button
                                  key={shift.id}
                                  onClick={() => handleShiftClick(shift)}
                                  className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift) ?? ""}`}
                                  style={getShiftStyle(shift)}
                                >
                                  <p className="font-medium">
                                    {formatTime(shift.start_time, tz)}
                                    {shift.end_time
                                      ? ` - ${formatTime(shift.end_time, tz)}`
                                      : ""}
                                  </p>
                                  {shift.notes && (
                                    <p className="mt-1 opacity-80 truncate">
                                      {shift.notes}
                                    </p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    {isUnderstaffed(shift) && (
                                      <span
                                        className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-xs"
                                        title={`Needs ${shift.min_staffing} staff`}
                                      >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                      </span>
                                    )}
                                    <span className="opacity-70 flex items-center gap-1 text-xs">
                                      <Users className="w-3.5 h-3.5" />{" "}
                                      {shift.attendee_count} staff
                                    </span>
                                    {shift.apparatus_unit_number && (
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Truck className="w-3.5 h-3.5" />{" "}
                                        {shift.apparatus_unit_number}
                                      </span>
                                    )}
                                  </div>
                                </button>
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
                          {dayShifts.map((shift) => (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-1 px-1.5 py-1 rounded-sm border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift) ?? ""}`}
                              style={getShiftStyle(shift)}
                            >
                              <p className="font-medium truncate">
                                {isUnderstaffed(shift) && (
                                  <AlertTriangle className="w-3 h-3 inline text-amber-600 dark:text-amber-400 mr-0.5" />
                                )}
                                {formatTime(shift.start_time, tz)}
                                {shift.apparatus_unit_number && (
                                  <span className="ml-1 opacity-70">
                                    {shift.apparatus_unit_number}
                                  </span>
                                )}
                                <span className="ml-1 opacity-70">
                                  ({shift.attendee_count})
                                </span>
                              </p>
                            </button>
                          ))}
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
                                  {date.toLocaleDateString("en-US", {
                                    weekday: "short",
                                    month: "short",
                                    day: "numeric",
                                    timeZone: tz,
                                  })}
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
                                {dayShifts.map((shift) => (
                                  <button
                                    key={shift.id}
                                    onClick={() => handleShiftClick(shift)}
                                    className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer active:ring-2 active:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift) ?? ""}`}
                                    style={getShiftStyle(shift)}
                                  >
                                    <p className="font-medium">
                                      {formatTime(shift.start_time, tz)}
                                      {shift.end_time
                                        ? ` - ${formatTime(shift.end_time, tz)}`
                                        : ""}
                                    </p>
                                    {shift.notes && (
                                      <p className="mt-1 opacity-80 truncate">
                                        {shift.notes}
                                      </p>
                                    )}
                                    <div className="flex items-center gap-3 mt-1.5">
                                      {isUnderstaffed(shift) && (
                                        <span
                                          className="text-amber-600 dark:text-amber-400 flex items-center gap-1 text-xs"
                                          title={`Needs ${shift.min_staffing} staff`}
                                        >
                                          <AlertTriangle className="w-3.5 h-3.5" />
                                        </span>
                                      )}
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Users className="w-3.5 h-3.5" />{" "}
                                        {shift.attendee_count} staff
                                      </span>
                                      {shift.apparatus_unit_number && (
                                        <span className="opacity-70 flex items-center gap-1 text-xs">
                                          <Truck className="w-3.5 h-3.5" />{" "}
                                          {shift.apparatus_unit_number}
                                        </span>
                                      )}
                                    </div>
                                  </button>
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
        {activeTab !== "schedule" && activeTab !== "settings" && (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === "my-shifts" && (
              <MyShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === "open-shifts" && (
              <OpenShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === "requests" && <RequestsTab />}
            {activeTab === "templates" && <ShiftTemplatesPage />}
            {activeTab === "patterns" && <PatternsTab />}
            {activeTab === "shift-reports" && <ShiftReportsTab />}
            {activeTab === "reports" && <SchedulingReportsPage />}
          </Suspense>
        )}

        {/* Settings Tab (inline, not lazy) */}
        {activeTab === "settings" && (
          <ShiftSettingsPanel
            templates={backendTemplates}
            apparatusList={apparatusList}
            onNavigateToTemplates={() => setActiveTab("templates")}
          />
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
                      >
                        {/* Group templates by category */}
                        {(() => {
                          const standard = effectiveTemplates.filter(
                            (t) => !t.category || t.category === "standard",
                          );
                          const specialty = effectiveTemplates.filter(
                            (t) => t.category === "specialty",
                          );
                          const event = effectiveTemplates.filter(
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
                                event.length === 0 &&
                                effectiveTemplates.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.name} ({t.start_time_of_day} -{" "}
                                    {t.end_time_of_day})
                                  </option>
                                ))}
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
                        const hasPositions =
                          tmpl.positions && tmpl.positions.length > 0;
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
                                  {tmpl.positions?.map((pos, i) => (
                                    <span
                                      key={i}
                                      className="px-2 py-0.5 text-[10px] bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-sm capitalize font-medium"
                                    >
                                      {pos}
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
                              setActiveTab("templates");
                            }}
                            className="text-violet-600 dark:text-violet-400 hover:underline"
                          >
                            Configure your own
                          </button>{" "}
                          in the Templates tab.
                        </p>
                      )}
                    </div>

                    {/* Custom Time Override */}
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4" /> Custom Times (optional)
                        </span>
                      </label>
                      <p className="text-xs text-theme-text-muted mb-2">Override the template times for this shift</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-theme-text-muted mb-1">Start Time</label>
                          <input
                            type="time"
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
                          <input
                            type="time"
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
                            <Truck className="w-4 h-4" /> Apparatus (optional)
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
                        {/* Positions preview when an apparatus is selected */}
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
                                  {selected.positions.map((pos, i) => (
                                    <span
                                      key={i}
                                      className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded-sm capitalize"
                                    >
                                      {pos}
                                    </span>
                                  ))}
                                </div>
                                <p className="text-xs text-theme-text-muted mt-1.5">
                                  Members will be able to sign up for these
                                  positions
                                </p>
                              </div>
                            );
                          }
                          if (shiftForm.apparatus_id) {
                            return (
                              <p className="text-xs text-theme-text-muted mt-1">
                                This apparatus has no positions defined. Members
                                can still sign up with any position.
                              </p>
                            );
                          }
                          return (
                            <p className="text-xs text-theme-text-muted mt-1">
                              Assign a vehicle to define crew positions for this
                              shift
                            </p>
                          );
                        })()}
                      </div>
                    )}

                    {/* Shift Officer Selection */}
                    {membersList.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                          <span className="flex items-center gap-1.5">
                            <Users className="w-4 h-4" /> Shift Officer
                            (optional)
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
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                        Notes
                      </label>
                      <textarea
                        value={shiftForm.notes}
                        onChange={(e) =>
                          setShiftForm({ ...shiftForm, notes: e.target.value })
                        }
                        rows={3}
                        className="form-input focus:ring-violet-500 resize-none"
                        placeholder="Optional notes for this shift..."
                      />
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

// ShiftSettingsPanel and SchedulingNotificationsPanel have been extracted
// to modules/scheduling/components/ for maintainability.
import { ShiftSettingsPanel } from "../modules/scheduling/components/ShiftSettingsPanel";



export default SchedulingPage;
