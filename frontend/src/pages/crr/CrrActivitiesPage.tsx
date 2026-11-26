/**
 * CRR Activities: the department's community risk reduction log.
 *
 * Reachable by the Community Outreach Team as well as by events managers
 * (owner decision, 2026-11-22), so it is a page of its own under Events
 * (/events/crr-activities, gated on crr.record or events.manage) and is also
 * drawn as a page of the Community Outreach area in Events Administration.
 *
 * Resident details come back only for crr.view_contact holders; everyone
 * else is told that details were recorded, not what they are.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import { MapPin, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { crrService } from '../../services/crrServices';
import type { CrrActivity, CrrFormOptions } from '../../types/crr';
import { EventsPageHeader } from '../../components/events/EventsPageHeader';
import { EmptyState } from '../../components/ux';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { useAuthStore } from '../../stores/authStore';
import { addCalendarDays, formatDateTime, getTodayLocalDate, localToUTC } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { asArray } from '../../utils/asArray';
import CrrActivityDialog from './CrrActivityDialog';

const PAGE_SIZE = 50;

const PERIODS = [
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
] as const;
type Period = (typeof PERIODS)[number]['value'];

/** The start of a period in the department's timezone, as UTC; undefined for all time. */
const periodStart = (period: Period, timezone: string): string | undefined => {
  if (period === 'all') return undefined;
  const start = addCalendarDays(getTodayLocalDate(timezone), -Number(period));
  return localToUTC(`${start}T00:00`, timezone);
};

const place = (activity: CrrActivity): string =>
  [activity.city, [activity.state, activity.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');

const minutesText = (minutes: number): string =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;

const ActivityCard: React.FC<{
  activity: CrrActivity;
  timezone: string;
  /** One level below the page's own title: h2 standalone, h3 inside the hub's tab. */
  headingLevel: 'h2' | 'h3';
  onDelete: (activity: CrrActivity) => void;
}> = ({ activity, timezone, headingLevel: Heading, onDelete }) => {
  const details = [
    activity.street_address,
    activity.resident_name,
    activity.resident_phone,
    activity.resident_email,
  ].filter(Boolean);
  return (
    <li className="card-secondary p-4" aria-labelledby={`crr-activity-${activity.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading id={`crr-activity-${activity.id}`} className="text-theme-text-primary font-semibold break-words">
            {activity.activity_type_name}
          </Heading>
          <p className="text-theme-text-secondary text-sm">
            {formatDateTime(activity.occurred_at, timezone)}
            {activity.recorded_by_name ? ` · recorded by ${activity.recorded_by_name}` : ''}
          </p>
          {place(activity) && (
            <p className="text-theme-text-secondary flex items-center gap-1 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {place(activity)}
            </p>
          )}
          {activity.event_id && (
            <Link
              to={`/events/${activity.event_id}`}
              className="text-theme-text-secondary focus-visible:ring-theme-focus-ring touch:min-h-11 inline-flex items-center text-sm underline focus-visible:ring-2 focus-visible:outline-none"
            >
              At {activity.event_title ?? 'an event'}
            </Link>
          )}
        </div>
        {activity.can_edit && (
          <button
            type="button"
            className="btn-secondary touch:min-h-11 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm"
            aria-label={`Delete this ${activity.activity_type_name} activity`}
            onClick={() => onDelete(activity)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>

      {activity.counts.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Counts">
          {activity.counts.map((count) => (
            <li key={count.measure_id} className="badge bg-theme-surface-secondary text-theme-text-primary">
              {count.label}: {count.quantity}
            </li>
          ))}
        </ul>
      )}
      {activity.tags.length > 0 && (
        <p className="text-theme-text-muted mt-2 text-sm">{activity.tags.map((t) => t.label).join(' · ')}</p>
      )}
      {activity.members.length > 0 && (
        <p className="text-theme-text-secondary mt-2 flex items-start gap-1 text-sm">
          <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {activity.members.map((m) => `${m.name} (${minutesText(m.minutes)})`).join(', ')}
        </p>
      )}

      {details.length > 0 || activity.notes ? (
        <div className="border-theme-surface-border mt-3 space-y-2 border-t pt-3 text-sm">
          {details.length > 0 && (
            <div>
              <p className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">Resident details</p>
              {details.map((line) => (
                <p key={line} className="text-theme-text-primary break-words">
                  {line}
                </p>
              ))}
            </div>
          )}
          {activity.notes && (
            <div>
              <p className="text-theme-text-muted text-xs font-semibold tracking-wider uppercase">Notes</p>
              <p className="text-theme-text-secondary break-words">{activity.notes}</p>
            </div>
          )}
        </div>
      ) : activity.resident_details_cleared ? (
        <p className="text-theme-text-muted mt-3 text-sm">Resident details were cleared after the retention period.</p>
      ) : activity.has_resident_details ? (
        <p className="text-theme-text-muted mt-3 text-sm">
          Resident details recorded. The Community Outreach Manager and above can see them.
        </p>
      ) : null}
    </li>
  );
};

interface CrrActivitiesPageProps {
  /** Drawn inside the Events Administration hub, which has its own header. */
  embedded?: boolean;
}

const CrrActivitiesPage: React.FC<CrrActivitiesPageProps> = ({ embedded = false }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [options, setOptions] = useState<CrrFormOptions | null>(null);
  const [activities, setActivities] = useState<CrrActivity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from the list's error: a list load that succeeds must not
  // clear the reason the Log button is unavailable.
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const latestLoad = useRef(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [period, setPeriod] = useState<Period>('90');
  // The Overview's "Log a CRR activity" arrives with ?new=1.
  const [dialogOpen, setDialogOpen] = useState(() => searchParams.get('new') === '1');

  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const next = new URLSearchParams(searchParams);
    next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    void crrService
      .getFormOptions()
      .then((data) =>
        setOptions({
          ...data,
          activity_types: asArray(data?.activity_types),
          tags: asArray(data?.tags),
          members: asArray(data?.members),
        })
      )
      .catch((err: unknown) =>
        setOptionsError(getErrorMessage(err, 'The activity form could not be loaded, so activities cannot be logged.'))
      );
  }, []);

  const load = useCallback(
    async (offset: number) => {
      // Only the latest load may land: a slow answer for an earlier filter
      // must not replace the list for the one chosen after it.
      const ticket = ++latestLoad.current;
      setLoading(true);
      try {
        const data = await crrService.listActivities({
          start: periodStart(period, tz),
          activity_type_id: typeFilter || undefined,
          limit: PAGE_SIZE,
          offset,
        });
        if (ticket !== latestLoad.current) return;
        const items = asArray(data?.items);
        setActivities((current) => (offset === 0 ? items : [...current, ...items]));
        setTotal(typeof data?.total === 'number' ? data.total : items.length);
        setError(null);
      } catch (err: unknown) {
        if (ticket !== latestLoad.current) return;
        setError(getErrorMessage(err, 'CRR activities could not be loaded.'));
      } finally {
        if (ticket === latestLoad.current) setLoading(false);
      }
    },
    [period, typeFilter, tz]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const remove = async (activity: CrrActivity) => {
    const ok = await confirm({
      title: 'Delete this activity?',
      message:
        activity.members.length > 0
          ? 'It is removed from the log, and the Admin Hours it credited are removed with it.'
          : 'It is removed from the log.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await crrService.deleteActivity(activity.id);
      toast.success('Activity deleted.');
      setActivities((current) => current.filter((a) => a.id !== activity.id));
      setTotal((count) => Math.max(count - 1, 0));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The activity could not be deleted.'));
    }
  };

  const logButton = (
    <button
      type="button"
      className="btn-primary inline-flex items-center gap-2"
      disabled={!options}
      aria-describedby={optionsError ? 'crr-options-error' : undefined}
      onClick={() => setDialogOpen(true)}
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Log a CRR activity
    </button>
  );

  return (
    <div className={embedded ? 'space-y-5 py-6' : 'mx-auto max-w-5xl space-y-5 p-4 sm:p-6'}>
      {embedded ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-bold">
              <ShieldCheck className="h-5 w-5 text-red-700 dark:text-red-400" aria-hidden="true" />
              CRR Activities
            </h2>
            <p className="text-theme-text-muted mt-1 text-sm">Community risk reduction work, newest first.</p>
          </div>
          {logButton}
        </div>
      ) : (
        <EventsPageHeader
          icon={ShieldCheck}
          title="CRR Activities"
          subtitle="Community risk reduction work: alarm installs, safety surveys, car seat checks and classes."
          actions={logButton}
        />
      )}

      <div className="flex flex-wrap gap-3">
        <div>
          <label htmlFor="crr-filter-type" className="form-label">
            Activity type
          </label>
          <select
            id="crr-filter-type"
            className="form-input"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {(options?.activity_types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="crr-filter-period" className="form-label">
            When
          </label>
          <select
            id="crr-filter-period"
            className="form-input"
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {optionsError && (
        <p id="crr-options-error" className="alert-danger text-sm" role="alert">
          {optionsError}
        </p>
      )}
      {error && (
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && activities.length === 0 ? (
        typeFilter || period !== 'all' ? (
          <EmptyState
            icon={ShieldCheck}
            title="No activities match these filters"
            description="Choose another activity type or a longer period, or log an activity."
          />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No CRR activities yet"
            description="Log an alarm install, a safety survey or a class to start the record."
          />
        )
      ) : (
        <ul className="space-y-3" aria-busy={loading}>
          {activities.map((activity) => (
            <ActivityCard
              key={activity.id}
              activity={activity}
              timezone={tz}
              headingLevel={embedded ? 'h3' : 'h2'}
              onDelete={(a) => void remove(a)}
            />
          ))}
        </ul>
      )}

      {activities.length < total && (
        <button
          type="button"
          className="btn-secondary touch:min-h-11"
          disabled={loading}
          onClick={() => void load(activities.length)}
        >
          Show more
        </button>
      )}

      {options && (
        <CrrActivityDialog
          isOpen={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            void load(0);
          }}
          options={options}
          timezone={tz}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
};

export default CrrActivitiesPage;
