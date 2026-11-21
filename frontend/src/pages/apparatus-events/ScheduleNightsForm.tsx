/**
 * Put a template on the calendar for one night or many. Each night becomes its
 * own event with its own crew. Times are entered on the department's wall
 * clock and sent as UTC instants.
 */

import React, { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CalendarPlus, Plus, Repeat, X } from 'lucide-react';
import { isAxiosError } from 'axios';
import { apparatusEventService } from '../../services/api';
import type { ApparatusConflict, ApparatusEventTemplate } from '../../types/apparatusEvent';
import { useTimezone } from '../../hooks/useTimezone';
import { formatCalendarDate, getTodayLocalDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { MAX_NIGHTS, nextKey, nightToSpec, weeklyDates, type NightDraft } from './templateForm';
import { EVOC_MODE_LABEL, EVOC_MODE_TONE, TONE } from './tones';

interface ScheduleNightsFormProps {
  template: ApparatusEventTemplate;
  onScheduled: () => void;
  onCancel: () => void;
}

const conflictsFrom = (err: unknown): ApparatusConflict[] | null => {
  if (!isAxiosError(err) || err.response?.status !== 409) return null;
  const detail = (err.response.data as { detail?: { conflicts?: ApparatusConflict[] } } | undefined)?.detail;
  return Array.isArray(detail?.conflicts) ? detail.conflicts : null;
};

export const ScheduleNightsForm: React.FC<ScheduleNightsFormProps> = ({ template, onScheduled, onCancel }) => {
  const tz = useTimezone();
  const makeNight = (date: string): NightDraft => ({
    key: nextKey(),
    date,
    start_time: template.default_start_time ?? '18:00',
    duration_minutes: String(template.duration_minutes),
    location: '',
  });

  const [title, setTitle] = useState(template.name);
  const [nights, setNights] = useState<NightDraft[]>(() => [makeNight(getTodayLocalDate(tz))]);
  const [weeklyCount, setWeeklyCount] = useState('4');
  const [conflicts, setConflicts] = useState<ApparatusConflict[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);

  const specs = useMemo(() => nights.map((n) => nightToSpec(n, tz)), [nights, tz]);
  const complete = specs.every((s) => s !== null) && nights.length > 0;
  const seatsPerNight = template.total_seats;

  // Conflicts are re-read whenever the nights change, so the warning is on
  // screen before the coordinator presses Create rather than after.
  useEffect(() => {
    if (!complete) {
      setConflicts([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      apparatusEventService
        .checkConflicts(
          template.id,
          specs.filter((s) => s !== null)
        )
        .then((found) => {
          if (!cancelled) setConflicts(found);
        })
        .catch(() => {
          // The submit re-checks on the server; a failed preview only means
          // the warning appears then instead of now.
          if (!cancelled) setConflicts([]);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [complete, specs, template.id]);

  useEffect(() => setAcknowledged(false), [conflicts.length]);

  const byNight = useMemo(() => {
    const map = new Map<number, ApparatusConflict[]>();
    conflicts.forEach((c) => map.set(c.night_index, [...(map.get(c.night_index) ?? []), c]));
    return map;
  }, [conflicts]);

  const update = (key: string, patch: Partial<NightDraft>) =>
    setNights((list) => list.map((n) => (n.key === key ? { ...n, ...patch } : n)));

  const addWeekly = () => {
    const count = Math.min(Number.parseInt(weeklyCount, 10) || 0, MAX_NIGHTS - nights.length + 1);
    const first = nights[nights.length - 1]?.date || getTodayLocalDate(tz);
    const dates = weeklyDates(first, count + 1).slice(1);
    setNights((list) => [...list, ...dates.map(makeNight)]);
  };

  const submit = async () => {
    const ready = specs.filter((s) => s !== null);
    if (ready.length !== nights.length || !title.trim()) return;
    setSaving(true);
    try {
      const result = await apparatusEventService.scheduleNights(template.id, {
        title: title.trim(),
        nights: ready,
        acknowledge_conflicts: acknowledged,
      });
      toast.success(`Scheduled ${result.event_ids.length} night${result.event_ids.length === 1 ? '' : 's'}`);
      onScheduled();
    } catch (err) {
      const found = conflictsFrom(err);
      if (found) {
        setConflicts(found);
        toast.error('Some nights conflict with another use of the apparatus. Review them below.');
      } else {
        toast.error(getErrorMessage(err, 'Could not schedule the nights.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const blocked = conflicts.length > 0 && !acknowledged;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
          <CalendarPlus className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
          Schedule nights from “{template.name}”
        </h2>
        <p className="text-theme-text-muted mt-1 text-sm">
          Each night becomes its own event with its own crew, so members sign up night by night.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card space-y-4 p-5">
          <div>
            <label className="form-label" htmlFor="sn-title">
              Event title <span className="text-red-700 dark:text-red-400">*</span>
            </label>
            <input
              id="sn-title"
              className="form-input"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <h3 className="text-theme-text-primary font-semibold">Nights</h3>
          <ol className="space-y-2">
            {nights.map((night, index) => {
              const nightConflicts = byNight.get(index) ?? [];
              return (
                <li
                  key={night.key}
                  className={`rounded-lg border p-3 ${
                    nightConflicts.length > 0
                      ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
                      : 'border-theme-surface-border'
                  }`}
                >
                  <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[10rem_9rem_6rem_minmax(0,1fr)_auto]">
                    <div>
                      <label className="form-label text-xs" htmlFor={`sn-date-${night.key}`}>
                        Night {index + 1}
                      </label>
                      <input
                        id={`sn-date-${night.key}`}
                        type="date"
                        className="form-input"
                        value={night.date}
                        onChange={(e) => update(night.key, { date: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="form-label text-xs" htmlFor={`sn-time-${night.key}`}>
                        Starts
                      </label>
                      <input
                        id={`sn-time-${night.key}`}
                        type="time"
                        className="form-input"
                        value={night.start_time}
                        onChange={(e) => update(night.key, { start_time: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="form-label text-xs" htmlFor={`sn-len-${night.key}`}>
                        Minutes
                      </label>
                      <input
                        id={`sn-len-${night.key}`}
                        type="number"
                        min={15}
                        max={1440}
                        step={15}
                        className="form-input"
                        value={night.duration_minutes}
                        onChange={(e) => update(night.key, { duration_minutes: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="form-label text-xs" htmlFor={`sn-loc-${night.key}`}>
                        Route or place
                      </label>
                      <input
                        id={`sn-loc-${night.key}`}
                        className="form-input"
                        placeholder={template.location ?? ''}
                        maxLength={300}
                        value={night.location}
                        onChange={(e) => update(night.key, { location: e.target.value })}
                      />
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-icon"
                      aria-label={`Remove night ${index + 1}`}
                      disabled={nights.length === 1}
                      onClick={() => setNights((list) => list.filter((n) => n.key !== night.key))}
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {nightConflicts.length > 0 && (
                    <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-200">
                      {nightConflicts.map((c, i) => (
                        <li key={`${c.apparatus_id}-${i}`} className="flex items-start gap-1.5">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          {c.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>

          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={nights.length >= MAX_NIGHTS}
              onClick={() => setNights((list) => [...list, makeNight(list[list.length - 1]?.date ?? '')])}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add a night
            </button>
            <div className="flex items-end gap-2">
              <div>
                <label className="form-label text-xs" htmlFor="sn-weekly">
                  Weeks after the last night
                </label>
                <input
                  id="sn-weekly"
                  type="number"
                  min={1}
                  max={MAX_NIGHTS}
                  className="form-input w-24"
                  value={weeklyCount}
                  onChange={(e) => setWeeklyCount(e.target.value)}
                />
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={addWeekly}>
                <Repeat className="h-4 w-4" aria-hidden="true" />
                Repeat weekly
              </button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="card space-y-2 p-5 text-sm">
            <h3 className="text-theme-text-primary font-semibold">Summary</h3>
            <div className="flex justify-between">
              <span className="text-theme-text-secondary">Nights</span>
              <span className="text-theme-text-primary font-semibold">{nights.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text-secondary">Seats per night</span>
              <span className="text-theme-text-primary font-semibold">{seatsPerNight}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-theme-text-secondary">Seats to fill</span>
              <span className="text-theme-text-primary font-semibold">{seatsPerNight * nights.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-theme-text-secondary">Driver</span>
              <span className={`badge ${EVOC_MODE_TONE[template.evoc_mode]}`}>
                {EVOC_MODE_LABEL[template.evoc_mode]}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-theme-text-secondary">Hours post to</span>
              <span className="text-theme-text-primary text-right font-semibold">
                {template.admin_hours_category_name ?? 'The event type’s mapping'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-theme-text-secondary">Counts as a shift</span>
              <span className={`badge ${TONE.slate}`}>Never</span>
            </div>
            {nights[0]?.date && (
              <p className="text-theme-text-muted pt-1 text-xs">
                First night {formatCalendarDate(nights[0].date, { weekday: 'short', month: 'short', day: 'numeric' })}
              </p>
            )}
            <div className="border-theme-surface-border space-y-2 border-t pt-3">
              {conflicts.length > 0 && (
                <label className="flex items-start gap-2 text-amber-900 dark:text-amber-200">
                  <input
                    type="checkbox"
                    className="form-checkbox mt-0.5"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  Schedule anyway. I’ve confirmed the apparatus can cover these nights.
                </label>
              )}
              <button
                type="button"
                className="btn-primary w-full justify-center"
                disabled={saving || !complete || blocked || !title.trim()}
                onClick={() => void submit()}
              >
                {saving ? 'Scheduling…' : `Create ${nights.length} night${nights.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="btn-secondary w-full justify-center" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </section>
          <div className="alert-info text-sm">
            Each night can be changed on its own afterwards, for example dropping to two elves on a rainy night, without
            touching the template or the other nights.
          </div>
        </aside>
      </div>
    </div>
  );
};

export default ScheduleNightsForm;
