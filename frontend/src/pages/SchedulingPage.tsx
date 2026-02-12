import React, { useState } from 'react';
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
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';

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
  { id: 'day', name: 'Day Shift', startTime: '07:00', endTime: '19:00', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30', icon: <Sun className="w-4 h-4" /> },
  { id: 'night', name: 'Night Shift', startTime: '19:00', endTime: '07:00', color: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30', icon: <Moon className="w-4 h-4" /> },
  { id: 'morning', name: 'Morning Shift', startTime: '06:00', endTime: '14:00', color: 'bg-orange-500/10 text-orange-400 border-orange-500/30', icon: <Sunrise className="w-4 h-4" /> },
];

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SchedulingPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('scheduling.manage');

  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showCreateShift, setShowCreateShift] = useState(false);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-red-900 to-slate-900">
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className="bg-violet-600 rounded-lg p-2">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-white text-2xl font-bold">Scheduling & Shifts</h1>
              <p className="text-slate-400 text-sm">
                Create shift schedules, manage duty rosters, and handle shift trades
              </p>
            </div>
          </div>
          {canManage && (
            <button
              onClick={() => setShowCreateShift(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Schedule</span>
            </button>
          )}
        </div>

        {/* Shift Templates */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {SHIFT_TEMPLATES.map((shift) => (
            <div key={shift.id} className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg border ${shift.color}`}>
                  {shift.icon}
                </div>
                <div>
                  <h3 className="text-white font-medium">{shift.name}</h3>
                  <p className="text-slate-400 text-sm">{shift.startTime} - {shift.endTime}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Calendar Navigation */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4 border border-white/20 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => navigateWeek(-1)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-white font-semibold text-lg">{formatDateRange()}</h2>
              <button
                onClick={() => navigateWeek(1)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-1.5 text-sm text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
              >
                Today
              </button>
              <div className="flex bg-slate-900/50 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('week')}
                  className={`px-3 py-1 rounded text-sm ${viewMode === 'week' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Week
                </button>
                <button
                  onClick={() => setViewMode('month')}
                  className={`px-3 py-1 rounded text-sm ${viewMode === 'month' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-white'}`}
                >
                  Month
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Week Calendar Grid */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden mb-8">
          <div className="grid grid-cols-7 border-b border-white/10">
            {weekDates.map((date, i) => (
              <div
                key={i}
                className={`p-3 text-center border-r border-white/10 last:border-r-0 ${
                  isToday(date) ? 'bg-violet-600/20' : ''
                }`}
              >
                <p className="text-slate-400 text-xs uppercase">{DAYS_OF_WEEK[i]}</p>
                <p className={`text-lg font-bold mt-1 ${
                  isToday(date) ? 'text-violet-400' : 'text-white'
                }`}>
                  {date.getDate()}
                </p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 min-h-[300px]">
            {weekDates.map((date, i) => (
              <div
                key={i}
                className={`p-2 border-r border-white/10 last:border-r-0 ${
                  isToday(date) ? 'bg-violet-600/5' : ''
                }`}
              />
            ))}
          </div>
        </div>

        {/* Empty State */}
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-12 border border-white/20 text-center">
          <CalendarDays className="w-16 h-16 text-slate-500 mx-auto mb-4" />
          <h3 className="text-white text-xl font-bold mb-2">No Schedules Created</h3>
          <p className="text-slate-300 mb-6">
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

        {/* Create Schedule Modal */}
        {showCreateShift && (
          <div className="fixed inset-0 z-50 overflow-y-auto">
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowCreateShift(false)} />
              <div className="relative bg-slate-800 rounded-lg shadow-xl max-w-lg w-full border border-white/20">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-white">Create Schedule</h3>
                    <button onClick={() => setShowCreateShift(false)} className="text-slate-400 hover:text-white">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Schedule Name *</label>
                      <input
                        type="text" value={shiftForm.name}
                        onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                        placeholder="e.g., February Week 3 Schedule"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Shift Template</label>
                      <select
                        value={shiftForm.shiftTemplate}
                        onChange={(e) => setShiftForm({ ...shiftForm, shiftTemplate: e.target.value })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      >
                        {SHIFT_TEMPLATES.map(t => (
                          <option key={t.id} value={t.id}>{t.name} ({t.startTime} - {t.endTime})</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Start Date</label>
                        <input
                          type="date" value={shiftForm.startDate}
                          onChange={(e) => setShiftForm({ ...shiftForm, startDate: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">End Date</label>
                        <input
                          type="date" value={shiftForm.endDate}
                          onChange={(e) => setShiftForm({ ...shiftForm, endDate: e.target.value })}
                          className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-300 mb-1">Minimum Staffing</label>
                      <input
                        type="number" min="1" value={shiftForm.minStaffing}
                        onChange={(e) => setShiftForm({ ...shiftForm, minStaffing: parseInt(e.target.value) || 1 })}
                        className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <div className="bg-violet-500/10 border border-violet-500/30 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <AlertCircle className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
                        <p className="text-violet-300 text-sm">
                          The scheduling backend is being developed. Schedule creation will be available soon.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-slate-900/50 px-6 py-3 flex justify-end space-x-3 rounded-b-lg">
                  <button
                    onClick={() => setShowCreateShift(false)}
                    className="px-4 py-2 border border-slate-600 rounded-lg text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled
                    className="px-4 py-2 bg-violet-600/50 text-white/50 rounded-lg cursor-not-allowed"
                  >
                    Create Schedule
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
