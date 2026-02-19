import React, { useState, useEffect, lazy, Suspense, useCallback } from 'react';
import {
  Clock,
  CalendarDays,
  Plus,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  X,
  Sun,
  Moon,
  Sunrise,
  Loader2,
  Users,
  UserPlus,
  ArrowLeftRight,
  ClipboardList,
  BarChart3,
  Truck,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatTime } from '../utils/dateFormatting';
import { schedulingService } from '../services/api';
import type { ShiftRecord, SchedulingSummary } from '../services/api';

// Lazy-loaded tab components
const MyShiftsTab = lazy(() => import('./scheduling/MyShiftsTab'));
const OpenShiftsTab = lazy(() => import('./scheduling/OpenShiftsTab'));
const RequestsTab = lazy(() => import('./scheduling/RequestsTab'));
const ShiftTemplatesPage = lazy(() => import('./ShiftTemplatesPage'));
const SchedulingReportsPage = lazy(() => import('./SchedulingReportsPage'));
const ShiftDetailPanel = lazy(() => import('./scheduling/ShiftDetailPanel'));

type TabId = 'schedule' | 'my-shifts' | 'open-shifts' | 'requests' | 'templates' | 'reports';
type ViewMode = 'week' | 'month';

interface ShiftTemplate {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  color: string;
  icon: React.ReactNode;
}

const SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: 'day', name: 'Day Shift', startTime: '07:00', endTime: '19:00', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30', icon: <Sun className="w-4 h-4" aria-hidden="true" /> },
  { id: 'night', name: 'Night Shift', startTime: '19:00', endTime: '07:00', color: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30', icon: <Moon className="w-4 h-4" aria-hidden="true" /> },
  { id: 'morning', name: 'Morning Shift', startTime: '06:00', endTime: '14:00', color: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30', icon: <Sunrise className="w-4 h-4" aria-hidden="true" /> },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatDateISO = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getShiftTemplateColor = (shift: ShiftRecord): string => {
  const startHour = new Date(shift.start_time).getHours();
  if (startHour >= 5 && startHour < 10) return 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30';
  if (startHour >= 10 && startHour < 17) return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
  return 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30';
};

const TAB_CONFIG: { id: TabId; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'my-shifts', label: 'My Shifts', icon: Clock },
  { id: 'open-shifts', label: 'Open Shifts', icon: UserPlus },
  { id: 'requests', label: 'Requests', icon: ArrowLeftRight },
  { id: 'templates', label: 'Templates', icon: ClipboardList, adminOnly: true },
  { id: 'reports', label: 'Reports', icon: BarChart3, adminOnly: true },
];

const TabLoadingFallback = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
  </div>
);

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const tz = useTimezone();
  const canManage = checkPermission('scheduling.manage');

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('schedule');

  // Calendar state
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [summary, setSummary] = useState<SchedulingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Shift detail panel
  const [selectedShift, setSelectedShift] = useState<ShiftRecord | null>(null);

  // Apparatus list for shift creation
  const [apparatusList, setApparatusList] = useState<Array<{ id: string; name: string; unit_number: string; apparatus_type: string; positions?: string[] }>>([]);

  const [shiftForm, setShiftForm] = useState({
    name: '',
    shiftTemplate: 'day',
    startDate: '',
    endDate: '',
    minStaffing: 4,
    notes: '',
    apparatus_id: '',
  });

  // Load apparatus list for the create modal
  useEffect(() => {
    const loadApparatus = async () => {
      try {
        const data = await schedulingService.getBasicApparatus();
        setApparatusList(data as Array<{ id: string; name: string; unit_number: string; apparatus_type: string; positions?: string[] }>);
      } catch {
        // Not critical — apparatus may not be set up yet
      }
    };
    loadApparatus();
  }, []);

  const getWeekDates = () => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  };

  const getMonthDates = () => {
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
  };

  const weekDates = getWeekDates();
  const monthDates = viewMode === 'month' ? getMonthDates() : [];

  const navigate_ = (direction: number) => {
    const newDate = new Date(currentDate);
    if (viewMode === 'month') {
      newDate.setMonth(newDate.getMonth() + direction);
    } else {
      newDate.setDate(newDate.getDate() + (direction * 7));
    }
    setCurrentDate(newDate);
  };

  const formatDateRange = () => {
    if (viewMode === 'month') {
      return currentDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }
    const start = weekDates[0];
    const end = weekDates[6];
    const startMonth = start.toLocaleString('en-US', { month: 'short', timeZone: tz });
    const endMonth = end.toLocaleString('en-US', { month: 'short', timeZone: tz });
    if (startMonth === endMonth) {
      return `${startMonth} ${start.getDate()} - ${end.getDate()}, ${start.getFullYear()}`;
    }
    return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  };

  const isToday = (date: Date) => {
    const today = new Date();
    return date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
  };

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let fetchedShifts: ShiftRecord[];
      if (viewMode === 'month') {
        fetchedShifts = await schedulingService.getMonthCalendar(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1
        );
      } else {
        const weekStartStr = formatDateISO(weekDates[0]);
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
    fetchShifts();
  }, [fetchShifts]);

  // Fetch summary on mount
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const summaryData = await schedulingService.getSummary();
        setSummary(summaryData);
      } catch {
        // Summary is non-critical
      }
    };
    fetchSummary();
  }, []);

  const getShiftsForDate = (date: Date): ShiftRecord[] => {
    const dateStr = formatDateISO(date);
    return shifts.filter((shift) => shift.shift_date === dateStr);
  };

  const handleCreateShift = async () => {
    if (!shiftForm.startDate) {
      setCreateError('Start date is required.');
      return;
    }

    setCreating(true);
    setCreateError(null);

    try {
      const template = SHIFT_TEMPLATES.find((t) => t.id === shiftForm.shiftTemplate) || SHIFT_TEMPLATES[0];
      const startDateTime = `${shiftForm.startDate}T${template.startTime}:00`;

      let endDate = shiftForm.startDate;
      const [startHour] = template.startTime.split(':').map(Number);
      const [endHour] = template.endTime.split(':').map(Number);
      if (endHour < startHour) {
        const nextDay = new Date(shiftForm.startDate);
        nextDay.setDate(nextDay.getDate() + 1);
        endDate = formatDateISO(nextDay);
      }
      const endDateTime = `${endDate}T${template.endTime}:00`;

      await schedulingService.createShift({
        shift_date: shiftForm.startDate,
        start_time: startDateTime,
        end_time: endDateTime,
        notes: shiftForm.notes || undefined,
        apparatus_id: shiftForm.apparatus_id || undefined,
      });

      // Refresh
      await fetchShifts();
      try {
        const summaryData = await schedulingService.getSummary();
        setSummary(summaryData);
      } catch { /* non-critical */ }

      setShiftForm({
        name: '',
        shiftTemplate: 'day',
        startDate: '',
        endDate: '',
        minStaffing: 4,
        notes: '',
        apparatus_id: '',
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

  const visibleTabs = TAB_CONFIG.filter(t => !t.adminOnly || canManage);

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
              <h1 className="text-theme-text-primary text-xl sm:text-2xl font-bold">Scheduling & Shifts</h1>
              <p className="text-theme-text-muted text-sm">
                Manage schedules, sign up for shifts, and handle trades
              </p>
            </div>
          </div>
          {canManage && activeTab === 'schedule' && (
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
        <div className="border-b border-theme-surface-border mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
          <nav className="flex space-x-1 overflow-x-auto scrollbar-thin" aria-label="Scheduling tabs">
            {visibleTabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? 'border-violet-600 text-violet-600 dark:text-violet-400'
                      : 'border-transparent text-theme-text-muted hover:text-theme-text-primary hover:border-theme-surface-border'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'schedule' && (
          <>
            {/* Summary Stats */}
            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
                  <p className="text-theme-text-muted text-sm">Total Shifts</p>
                  <p className="text-theme-text-primary text-2xl font-bold">{summary.total_shifts}</p>
                </div>
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
                  <p className="text-theme-text-muted text-sm">This Week</p>
                  <p className="text-theme-text-primary text-2xl font-bold">{summary.shifts_this_week}</p>
                </div>
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
                  <p className="text-theme-text-muted text-sm">This Month</p>
                  <p className="text-theme-text-primary text-2xl font-bold">{summary.shifts_this_month}</p>
                </div>
                <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
                  <p className="text-theme-text-muted text-sm">Hours This Month</p>
                  <p className="text-theme-text-primary text-2xl font-bold">{summary.total_hours_this_month}</p>
                </div>
              </div>
            )}

            {/* Calendar Navigation */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-3 sm:p-4 border border-theme-surface-border mb-6">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center space-x-2 sm:space-x-4">
                  <button
                    onClick={() => navigate_(-1)}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}
                  >
                    <ChevronLeft className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <h2 className="text-theme-text-primary font-semibold text-base sm:text-lg whitespace-nowrap">{formatDateRange()}</h2>
                  <button
                    onClick={() => navigate_(1)}
                    className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
                    aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}
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
                  <div className="flex bg-theme-input-bg rounded-lg p-1" role="tablist" aria-label="Calendar view mode">
                    <button
                      onClick={() => setViewMode('week')}
                      role="tab"
                      aria-selected={viewMode === 'week'}
                      className={`px-3 py-1 rounded text-sm ${viewMode === 'week' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-white'}`}
                    >
                      Week
                    </button>
                    <button
                      onClick={() => setViewMode('month')}
                      role="tab"
                      aria-selected={viewMode === 'month'}
                      className={`px-3 py-1 rounded text-sm ${viewMode === 'month' ? 'bg-violet-600 text-white' : 'text-theme-text-muted hover:text-white'}`}
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
                <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" />
                <p className="text-red-700 dark:text-red-300">{error}</p>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-12 text-center mb-8">
                <Loader2 className="w-8 h-8 text-violet-700 dark:text-violet-400 mx-auto mb-3 animate-spin" />
                <p className="text-theme-text-secondary">Loading shifts...</p>
              </div>
            )}

            {/* Week Calendar Grid — desktop: 7-column grid, mobile: stacked list */}
            {!loading && viewMode === 'week' && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="hidden md:block bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden mb-8">
                  <div className="grid grid-cols-7 border-b border-theme-surface-border">
                    {weekDates.map((date, i) => (
                      <div
                        key={i}
                        className={`p-3 text-center border-r border-theme-surface-border last:border-r-0 ${
                          isToday(date) ? 'bg-violet-600/20' : ''
                        }`}
                      >
                        <p className="text-theme-text-muted text-xs uppercase">{DAYS_OF_WEEK[i]}</p>
                        <p className={`text-lg font-bold mt-1 ${
                          isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                        }`}>
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
                            isToday(date) ? 'bg-violet-600/5' : ''
                          }`}
                        >
                          {dayShifts.map((shift) => (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-2 p-2 rounded-lg border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift)}`}
                            >
                              <p className="font-medium truncate">
                                {formatTime(shift.start_time, tz)}
                                {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                              </p>
                              {shift.notes && (
                                <p className="mt-1 opacity-80 truncate">{shift.notes}</p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                {shift.attendee_count > 0 && (
                                  <span className="opacity-70 flex items-center gap-0.5">
                                    <Users className="w-3 h-3" /> {shift.attendee_count}
                                  </span>
                                )}
                                {shift.apparatus_unit_number && (
                                  <span className="opacity-70 flex items-center gap-0.5">
                                    <Truck className="w-3 h-3" /> {shift.apparatus_unit_number}
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
                        className={`bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden ${
                          isToday(date) ? 'ring-2 ring-violet-500/30' : ''
                        }`}
                      >
                        <div className={`px-4 py-2 border-b border-theme-surface-border flex items-center justify-between ${
                          isToday(date) ? 'bg-violet-600/10' : 'bg-theme-surface-secondary'
                        }`}>
                          <span className={`text-sm font-semibold ${
                            isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                          }`}>
                            {DAYS_OF_WEEK[i]}, {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          {isToday(date) && (
                            <span className="text-xs px-2 py-0.5 bg-violet-600 text-white rounded-full">Today</span>
                          )}
                        </div>
                        <div className="p-3">
                          {dayShifts.length === 0 ? (
                            <p className="text-theme-text-muted text-sm text-center py-2">No shifts</p>
                          ) : (
                            <div className="space-y-2">
                              {dayShifts.map((shift) => (
                                <button
                                  key={shift.id}
                                  onClick={() => handleShiftClick(shift)}
                                  className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift)}`}
                                >
                                  <p className="font-medium">
                                    {formatTime(shift.start_time, tz)}
                                    {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                                  </p>
                                  {shift.notes && (
                                    <p className="mt-1 opacity-80 truncate">{shift.notes}</p>
                                  )}
                                  <div className="flex items-center gap-3 mt-1.5">
                                    {shift.attendee_count > 0 && (
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Users className="w-3.5 h-3.5" /> {shift.attendee_count} staff
                                      </span>
                                    )}
                                    {shift.apparatus_unit_number && (
                                      <span className="opacity-70 flex items-center gap-1 text-xs">
                                        <Truck className="w-3.5 h-3.5" /> {shift.apparatus_unit_number}
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
            {!loading && viewMode === 'month' && (
              <>
                {/* Desktop grid (hidden on mobile) */}
                <div className="hidden md:block bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden mb-8">
                  <div className="grid grid-cols-7 border-b border-theme-surface-border">
                    {DAYS_OF_WEEK.map((day) => (
                      <div key={day} className="p-3 text-center border-r border-theme-surface-border last:border-r-0">
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
                          className={`p-2 border-r border-b border-theme-surface-border last:border-r-0 min-h-[100px] ${
                            isToday(date) ? 'bg-violet-600/5' : ''
                          } ${!isCurrentMonth ? 'opacity-40' : ''}`}
                        >
                          <p className={`text-sm font-medium mb-1 ${
                            isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                          }`}>
                            {date.getDate()}
                          </p>
                          {dayShifts.map((shift) => (
                            <button
                              key={shift.id}
                              onClick={() => handleShiftClick(shift)}
                              className={`mb-1 px-1.5 py-1 rounded border text-xs w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift)}`}
                            >
                              <p className="font-medium truncate">
                                {formatTime(shift.start_time)}
                                {shift.apparatus_unit_number && <span className="ml-1 opacity-70">{shift.apparatus_unit_number}</span>}
                                {shift.attendee_count > 0 && <span className="ml-1 opacity-70">({shift.attendee_count})</span>}
                              </p>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Mobile list view (shown on mobile only) — only days with shifts */}
                <div className="md:hidden space-y-2 mb-8">
                  {(() => {
                    const daysWithShifts = monthDates
                      .filter(date => date.getMonth() === currentDate.getMonth())
                      .filter(date => getShiftsForDate(date).length > 0);

                    if (daysWithShifts.length === 0) {
                      return (
                        <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border p-8 text-center">
                          <CalendarDays className="w-10 h-10 text-theme-text-muted mx-auto mb-2" />
                          <p className="text-theme-text-muted text-sm">No shifts this month</p>
                        </div>
                      );
                    }

                    return daysWithShifts.map((date, i) => {
                      const dayShifts = getShiftsForDate(date);
                      return (
                        <div
                          key={i}
                          className={`bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden ${
                            isToday(date) ? 'ring-2 ring-violet-500/30' : ''
                          }`}
                        >
                          <div className={`px-4 py-2 border-b border-theme-surface-border flex items-center justify-between ${
                            isToday(date) ? 'bg-violet-600/10' : 'bg-theme-surface-secondary'
                          }`}>
                            <span className={`text-sm font-semibold ${
                              isToday(date) ? 'text-violet-700 dark:text-violet-400' : 'text-theme-text-primary'
                            }`}>
                              {date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                            </span>
                            {isToday(date) && (
                              <span className="text-xs px-2 py-0.5 bg-violet-600 text-white rounded-full">Today</span>
                            )}
                          </div>
                          <div className="p-3 space-y-2">
                            {dayShifts.map((shift) => (
                              <button
                                key={shift.id}
                                onClick={() => handleShiftClick(shift)}
                                className={`p-3 rounded-lg border text-sm w-full text-left cursor-pointer hover:ring-2 hover:ring-violet-500/50 transition-all ${getShiftTemplateColor(shift)}`}
                              >
                                <p className="font-medium">
                                  {formatTime(shift.start_time, tz)}
                                  {shift.end_time ? ` - ${formatTime(shift.end_time, tz)}` : ''}
                                </p>
                                {shift.notes && (
                                  <p className="mt-1 opacity-80 truncate">{shift.notes}</p>
                                )}
                                <div className="flex items-center gap-3 mt-1.5">
                                  {shift.attendee_count > 0 && (
                                    <span className="opacity-70 flex items-center gap-1 text-xs">
                                      <Users className="w-3.5 h-3.5" /> {shift.attendee_count} staff
                                    </span>
                                  )}
                                  {shift.apparatus_unit_number && (
                                    <span className="opacity-70 flex items-center gap-1 text-xs">
                                      <Truck className="w-3.5 h-3.5" /> {shift.apparatus_unit_number}
                                    </span>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}

            {/* Empty State */}
            {!loading && !hasShifts && (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
                <CalendarDays className="w-16 h-16 text-theme-text-muted mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Shifts Scheduled</h3>
                <p className="text-theme-text-secondary mb-6">
                  Start building shift schedules and duty rosters for your department.
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
        {activeTab !== 'schedule' && (
          <Suspense fallback={<TabLoadingFallback />}>
            {activeTab === 'my-shifts' && (
              <MyShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === 'open-shifts' && (
              <OpenShiftsTab onViewShift={handleShiftClick} />
            )}
            {activeTab === 'requests' && <RequestsTab />}
            {activeTab === 'templates' && <ShiftTemplatesPage />}
            {activeTab === 'reports' && <SchedulingReportsPage />}
          </Suspense>
        )}

        {/* Shift Detail Panel */}
        {selectedShift && (
          <Suspense fallback={null}>
            <ShiftDetailPanel
              shift={selectedShift}
              onClose={() => setSelectedShift(null)}
              onRefresh={fetchShifts}
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
            onKeyDown={(e) => { if (e.key === 'Escape') setShowCreateShift(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateShift(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-schedule-title" className="text-lg font-medium text-theme-text-primary">Create Shift</h3>
                    <button onClick={() => setShowCreateShift(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Name</label>
                      <input
                        type="text" value={shiftForm.name}
                        onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="e.g., February Week 3 Schedule"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Template</label>
                      <select
                        value={shiftForm.shiftTemplate}
                        onChange={(e) => setShiftForm({ ...shiftForm, shiftTemplate: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {SHIFT_TEMPLATES.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.startTime} - {t.endTime})</option>
                        ))}
                      </select>
                    </div>

                    {/* Apparatus Selection */}
                    {apparatusList.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">
                          <span className="flex items-center gap-1.5"><Truck className="w-4 h-4" /> Apparatus (optional)</span>
                        </label>
                        <select
                          value={shiftForm.apparatus_id}
                          onChange={(e) => setShiftForm({ ...shiftForm, apparatus_id: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        >
                          <option value="">No specific apparatus</option>
                          {apparatusList.map(a => (
                            <option key={a.id} value={a.id}>{a.unit_number} — {a.name}</option>
                          ))}
                        </select>
                        {/* Positions preview when an apparatus is selected */}
                        {(() => {
                          const selected = apparatusList.find(a => a.id === shiftForm.apparatus_id);
                          if (selected?.positions && selected.positions.length > 0) {
                            return (
                              <div className="mt-2 p-2.5 bg-violet-500/5 border border-violet-500/20 rounded-lg">
                                <p className="text-xs font-medium text-violet-700 dark:text-violet-400 mb-1.5">
                                  Positions on {selected.unit_number}:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {selected.positions.map((pos, i) => (
                                    <span key={i} className="px-2 py-0.5 text-xs bg-violet-500/10 text-violet-700 dark:text-violet-300 rounded capitalize">
                                      {pos}
                                    </span>
                                  ))}
                                </div>
                                <p className="text-xs text-theme-text-muted mt-1.5">
                                  Members will be able to sign up for these positions
                                </p>
                              </div>
                            );
                          }
                          if (shiftForm.apparatus_id) {
                            return (
                              <p className="text-xs text-theme-text-muted mt-1">
                                This apparatus has no positions defined. Members can still sign up with any position.
                              </p>
                            );
                          }
                          return (
                            <p className="text-xs text-theme-text-muted mt-1">
                              Assign a vehicle to define crew positions for this shift
                            </p>
                          );
                        })()}
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Date *</label>
                        <input
                          type="date" value={shiftForm.startDate}
                          onChange={(e) => setShiftForm({ ...shiftForm, startDate: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">End Date</label>
                        <input
                          type="date" value={shiftForm.endDate}
                          onChange={(e) => setShiftForm({ ...shiftForm, endDate: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Notes</label>
                      <textarea
                        value={shiftForm.notes}
                        onChange={(e) => setShiftForm({ ...shiftForm, notes: e.target.value })}
                        rows={3}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                        placeholder="Optional notes for this shift..."
                      />
                    </div>
                    {createError && (
                      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                        <div className="flex items-start space-x-2">
                          <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-400 mt-0.5 flex-shrink-0" />
                          <p className="text-red-700 dark:text-red-300 text-sm">{createError}</p>
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
                    onClick={handleCreateShift}
                    disabled={creating || !shiftForm.startDate}
                    className={`px-4 py-2 rounded-lg transition-colors inline-flex items-center space-x-2 ${
                      creating || !shiftForm.startDate
                        ? 'bg-violet-600/50 text-white/50 cursor-not-allowed'
                        : 'bg-violet-600 hover:bg-violet-700 text-white'
                    }`}
                  >
                    {creating && <Loader2 className="w-4 h-4 animate-spin" />}
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
