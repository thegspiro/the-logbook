import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { schedulingService } from '../services/api';
import type { ShiftRecord, SchedulingSummary } from '../services/api';

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

const formatTime = (isoString: string): string => {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('scheduling.manage');

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [summary, setSummary] = useState<SchedulingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [shiftForm, setShiftForm] = useState({
    name: '',
    shiftTemplate: 'day',
    startDate: '',
    endDate: '',
    minStaffing: 4,
    notes: '',
  });

  const getWeekDates = () => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  };

  const weekDates = getWeekDates();

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setCurrentDate(newDate);
  };

  const formatDateRange = () => {
    const start = weekDates[0];
    const end = weekDates[6];
    const startMonth = start.toLocaleString('en-US', { month: 'short' });
    const endMonth = end.toLocaleString('en-US', { month: 'short' });
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

  // Fetch shifts for the current week whenever weekDates change
  useEffect(() => {
    const fetchShifts = async () => {
      setLoading(true);
      setError(null);
      try {
        const weekStartStr = formatDateISO(weekDates[0]);
        const weekShifts = await schedulingService.getWeekCalendar(weekStartStr);
        setShifts(weekShifts);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load shifts';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    fetchShifts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  // Fetch summary on mount
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const summaryData = await schedulingService.getSummary();
        setSummary(summaryData);
      } catch {
        // Summary is non-critical, silently ignore errors
      }
    };

    fetchSummary();
  }, []);

  // Get shifts for a specific date
  const getShiftsForDate = (date: Date): ShiftRecord[] => {
    const dateStr = formatDateISO(date);
    return shifts.filter((shift) => shift.shift_date === dateStr);
  };

  // Handle creating a shift
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

      // For night shifts that cross midnight, the end date is the next day
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
      });

      // Refresh shifts for the current week
      const weekStartStr = formatDateISO(weekDates[0]);
      const weekShifts = await schedulingService.getWeekCalendar(weekStartStr);
      setShifts(weekShifts);

      // Refresh summary
      try {
        const summaryData = await schedulingService.getSummary();
        setSummary(summaryData);
      } catch {
        // Non-critical
      }

      // Reset form and close modal
      setShiftForm({
        name: '',
        shiftTemplate: 'day',
        startDate: '',
        endDate: '',
        minStaffing: 4,
        notes: '',
      });
      setShowCreateShift(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create shift';
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const hasShifts = shifts.length > 0;

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-violet-600 rounded-lg p-2">
              <Clock className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-theme-text-primary text-2xl font-bold">Scheduling & Shifts</h1>
              <p className="text-theme-text-muted text-sm">
                Create shift schedules, manage duty rosters, and handle shift trades
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowCreateShift(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Create Schedule</span>
            </button>
          )}
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
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
          </div>
        )}

        {/* Shift Templates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {SHIFT_TEMPLATES.map((shift) => (
            <div key={shift.id} className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg border ${shift.color}`}>
                  {shift.icon}
                </div>
                <div>
                  <h3 className="text-theme-text-primary font-medium">{shift.name}</h3>
                  <p className="text-theme-text-muted text-sm">{shift.startTime} - {shift.endTime}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Calendar Navigation */}
        <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigateWeek(-1)}
                className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                aria-label="Previous week"
              >
                <ChevronLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <h2 className="text-theme-text-primary font-semibold text-lg">{formatDateRange()}</h2>
              <button
                onClick={() => navigateWeek(1)}
                className="p-2 text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover rounded-lg transition-colors"
                aria-label="Next week"
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

        {/* Week Calendar Grid */}
        {!loading && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden mb-8">
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
                      <div
                        key={shift.id}
                        className={`mb-2 p-2 rounded-lg border text-xs ${getShiftTemplateColor(shift)}`}
                      >
                        <p className="font-medium truncate">
                          {formatTime(shift.start_time)}
                          {shift.end_time ? ` - ${formatTime(shift.end_time)}` : ''}
                        </p>
                        {shift.notes && (
                          <p className="mt-1 opacity-80 truncate">{shift.notes}</p>
                        )}
                        {shift.attendee_count > 0 && (
                          <p className="mt-1 opacity-70">{shift.attendee_count} attendee{shift.attendee_count !== 1 ? 's' : ''}</p>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && !hasShifts && (
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <CalendarDays className="w-16 h-16 text-slate-500 mx-auto mb-4" />
            <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Schedules Created</h3>
            <p className="text-theme-text-secondary mb-6">
              Start building shift schedules and duty rosters for your department.
            </p>
            {canManage && (
              <button
                onClick={() => setShowCreateShift(true)}
                className="px-6 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors inline-flex items-center space-x-2"
              >
                <Plus className="w-5 h-5" />
                <span>Create First Schedule</span>
              </button>
            )}
          </div>
        )}

        {/* Create Schedule Modal */}
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
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 id="create-schedule-title" className="text-lg font-medium text-theme-text-primary">Create Schedule</h3>
                    <button onClick={() => setShowCreateShift(false)} className="text-theme-text-muted hover:text-theme-text-primary" aria-label="Close dialog">
                      <X className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-theme-text-secondary mb-1">Schedule Name</label>
                      <input
                        id="schedule-name"
                        type="text" required aria-required="true" value={shiftForm.name}
                        onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="e.g., February Week 3 Schedule"
                      />
                    </div>
                    <div>
                      <label htmlFor="shift-template" className="block text-sm font-medium text-theme-text-secondary mb-1">Shift Template</label>
                      <select
                        id="shift-template"
                        value={shiftForm.shiftTemplate}
                        onChange={(e) => setShiftForm({ ...shiftForm, shiftTemplate: e.target.value })}
                        className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {SHIFT_TEMPLATES.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.startTime} - {t.endTime})</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-theme-text-secondary mb-1">Start Date *</label>
                        <input
                          id="schedule-start-date"
                          type="date" value={shiftForm.startDate}
                          onChange={(e) => setShiftForm({ ...shiftForm, startDate: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="schedule-end-date" className="block text-sm font-medium text-theme-text-secondary mb-1">End Date</label>
                        <input
                          id="schedule-end-date"
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
                    className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-slate-700 transition-colors"
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
                    <span>{creating ? 'Creating...' : 'Create Schedule'}</span>
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
