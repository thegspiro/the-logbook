import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, ClipboardX, Gauge, ShieldAlert, UserRoundPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import toast from 'react-hot-toast';
import DashboardStatCard from './DashboardStatCard';
import {
  schedulingService,
  type SchedulingWidgetFilters,
  type SchedulingWidgetPreferences,
  type SchedulingWidgetSummary,
} from '../../modules/scheduling/services/api';
import { addCalendarDays, getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const DEFAULT_FILTERS: SchedulingWidgetFilters = { horizon_days: 14 };
const WIDGETS = [
  ['today_staffing', 'Today’s Staffing', 'today_staffing', Users, 'tab=calendar'],
  ['future_coverage_gaps', 'Future Coverage Gaps', 'future_coverage_gaps', AlertTriangle, 'tab=open-shifts'],
  ['open_slots', 'Open Slots', 'open_slots', UserRoundPlus, 'tab=open-shifts'],
  ['pending_staffing_changes', 'Pending Changes', 'pending_staffing_changes', CalendarClock, 'tab=requests'],
  ['incomplete_closeouts', 'Incomplete Closeouts', 'incomplete_closeouts', ClipboardX, 'tab=reports'],
  ['workload_balance', 'Workload Balance', 'workload_imbalance', Gauge, 'tab=reports'],
  [
    'special_operations',
    'Special Operations',
    'special_operations',
    ShieldAlert,
    'tab=calendar&special_operations=true',
  ],
] as const;

const SchedulingWidgets: React.FC<{ timezone: string }> = ({ timezone }) => {
  const navigate = useNavigate();
  const [preferences, setPreferences] = useState<SchedulingWidgetPreferences>({ widgets: {} });
  const [summaries, setSummaries] = useState<Record<string, SchedulingWidgetSummary>>({});
  const [editing, setEditing] = useState('today_staffing');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const saved = await schedulingService.getWidgetPreferences();
      setPreferences(saved);
      const today = getTodayLocalDate(timezone);
      const results = await Promise.all(
        WIDGETS.map(async ([key]) => {
          const filters = saved.widgets[key] ?? DEFAULT_FILTERS;
          const summary = await schedulingService.getWidgetSummary({
            start_date: today,
            end_date: addCalendarDays(today, filters.horizon_days - 1),
            ...(filters.station_id ? { station_id: filters.station_id } : {}),
            ...(filters.platoon ? { platoon: filters.platoon } : {}),
          });
          return [key, summary] as const;
        })
      );
      setSummaries(Object.fromEntries(results));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Scheduling summaries could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => void load(), [load]);

  const current = preferences.widgets[editing] ?? DEFAULT_FILTERS;
  const updateCurrent = (patch: Partial<SchedulingWidgetFilters>) => {
    setPreferences((value) => ({
      widgets: { ...value.widgets, [editing]: { ...current, ...patch } },
    }));
  };
  const updateOptional = (field: 'station_id' | 'platoon', value: string) => {
    const next = { ...current };
    if (value) next[field] = value;
    else delete next[field];
    setPreferences((saved) => ({ widgets: { ...saved.widgets, [editing]: next } }));
  };
  const save = async () => {
    try {
      await schedulingService.saveWidgetPreferences(preferences);
      toast.success('Widget defaults saved');
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Those filters are no longer available.'));
    }
  };

  const enabled = Object.values(summaries)[0]?.scheduling_enabled ?? true;
  const widgetLink = (key: string, baseQuery: string) => {
    const params = new URLSearchParams(baseQuery);
    const filters = preferences.widgets[key] ?? DEFAULT_FILTERS;
    params.set('date', getTodayLocalDate(timezone));
    params.set('horizon_days', String(filters.horizon_days));
    if (filters.station_id) params.set('station_id', filters.station_id);
    if (filters.platoon) params.set('platoon', filters.platoon);
    return `/scheduling?${params.toString()}`;
  };
  return (
    <section aria-labelledby="scheduling-widgets-heading">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="scheduling-widgets-heading" className="text-theme-text-primary text-lg font-semibold">
            Scheduling Operations
          </h3>
          <p className="text-theme-text-muted text-sm">Today and rolling windows use {timezone}.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-theme-text-secondary text-xs">
            Widget
            <select
              className="form-input mt-1 block"
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
            >
              {WIDGETS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-theme-text-secondary text-xs">
            Station ID
            <input
              className="form-input mt-1 w-32"
              value={current.station_id ?? ''}
              onChange={(event) => updateOptional('station_id', event.target.value)}
            />
          </label>
          <label className="text-theme-text-secondary text-xs">
            Platoon
            <input
              className="form-input mt-1 w-24"
              value={current.platoon ?? ''}
              onChange={(event) => updateOptional('platoon', event.target.value)}
            />
          </label>
          <label className="text-theme-text-secondary text-xs">
            Days
            <select
              className="form-input mt-1 block"
              value={current.horizon_days}
              onChange={(event) => updateCurrent({ horizon_days: Number(event.target.value) })}
            >
              {[7, 14, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn-primary min-h-11 px-4" onClick={() => void save()}>
            Save defaults
          </button>
        </div>
      </div>
      {!enabled ? (
        <div className="card p-5 text-sm" role="status">
          Scheduling is disabled for this organization.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {WIDGETS.map(([key, label, field, Icon, query]) => {
            const summary = summaries[key];
            return (
              <DashboardStatCard
                key={key}
                label={label}
                value={summary?.[field] ?? 0}
                icon={Icon}
                iconColor="text-red-600 dark:text-red-400"
                description={`${preferences.widgets[key]?.horizon_days ?? 14}-day window`}
                loading={loading}
                onClick={() => void navigate(widgetLink(key, query))}
                ariaLabel={`${label}: ${summary?.[field] ?? 0}. View filtered schedule.`}
              />
            );
          })}
        </div>
      )}
    </section>
  );
};

export default SchedulingWidgets;
