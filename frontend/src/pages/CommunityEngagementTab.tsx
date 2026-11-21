/**
 * Community Engagement Tab (PO3)
 *
 * What the department's public outreach reached over a period: events held,
 * people reached (signed in, or estimated from the request where nobody signed
 * in), member hours given and public requests answered.
 * Lazy-loaded as a tab in EventsAdminHub.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import toast from 'react-hot-toast';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  Download,
  Globe,
  Inbox,
  Loader2,
  Printer,
  Users,
} from 'lucide-react';
import { dashboardService } from '../services/api';
import type { CommunityEngagement, CommunityPeriod } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { formatNumber, getTodayLocalDate } from '../utils/dateFormatting';
import { formatHours } from '../utils/hoursFormatting';
import { buildCsv, downloadCsv } from '../utils/csv';
import { getErrorMessage } from '../utils/errorHandling';
import {
  COMMUNITY_PERIODS,
  changeFor,
  csvRows,
  eventDate,
  expectedText,
  parseCommunityPeriod,
  reachText,
  typeGroups,
  turnoutPercent,
  type Change,
} from './community-engagement/communityEngagement';
import { ReachByPeriodChart, ReachByTypeBars, ReachLegend } from './community-engagement/CommunityCharts';

const ChangeBadge: React.FC<{ change: Change | null; against: string | null }> = ({ change, against }) => {
  if (!change) return null;
  const tone =
    change.direction === 'up'
      ? 'text-green-900 dark:text-green-300'
      : change.direction === 'down'
        ? 'text-red-900 dark:text-red-300'
        : 'text-theme-text-muted';
  const Icon = change.direction === 'up' ? ArrowUpRight : change.direction === 'down' ? ArrowDownRight : null;
  return (
    <span className={`inline-flex items-center text-xs font-medium ${tone}`}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      {/* Its own element, so axe measures the text without the icon beside it. */}
      <span>{change.text}</span>
      {against && <span className="sr-only"> compared with {against}</span>}
    </span>
  );
};

const Kpi: React.FC<{
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  change?: Change | null;
  against: string | null;
}> = ({ icon: Icon, label, value, sub, change = null, against }) => (
  <div className="card-secondary p-4" role="group" aria-label={label}>
    <div className="text-theme-text-muted mb-1 flex items-center gap-2 text-xs font-semibold tracking-wider uppercase">
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span>{label}</span>
    </div>
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-theme-text-primary text-3xl font-bold tabular-nums">{value}</span>
      <ChangeBadge change={change} against={against} />
    </div>
    <p className="text-theme-text-muted mt-1 text-xs">{sub}</p>
  </div>
);

const CommunityEngagementTab: React.FC = () => {
  const tz = useTimezone();
  const phone = useMediaQuery('(max-width: 639px)');
  const [searchParams, setSearchParams] = useSearchParams();
  const period = parseCommunityPeriod(searchParams.get('period'));
  const [data, setData] = useState<CommunityEngagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async (which: CommunityPeriod) => {
    setLoading(true);
    setError(null);
    try {
      setData(await dashboardService.getCommunityEngagement(which));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to load community engagement data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  // The period lives in the URL beside the tab, so the dashboard card's link,
  // a bookmark and the back button all land on the same report.
  const choosePeriod = (next: CommunityPeriod) => {
    const params = new URLSearchParams(searchParams);
    params.set('period', next);
    setSearchParams(params, { replace: true });
  };

  const option = COMMUNITY_PERIODS.find((p) => p.value === period) ?? COMMUNITY_PERIODS[0];
  const against = option?.previous ?? null;

  const periodSwitch = (
    <div className="segmented-group flex flex-wrap gap-1" role="group" aria-label="Period">
      {COMMUNITY_PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => choosePeriod(p.value)}
          aria-pressed={p.value === period}
          className={`touch:min-h-11 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            p.value === period
              ? 'bg-red-800 text-white'
              : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );

  const header = (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
          <Globe className="h-5 w-5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
          <span>Community Engagement</span>
        </h2>
        <p className="text-theme-text-muted mt-1 text-sm">How far the department&apos;s public outreach reaches.</p>
      </div>
      {periodSwitch}
    </div>
  );

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-7xl py-8">
        {header}
        <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading community engagement</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-7xl py-8">
        {header}
        <div className="alert-danger rounded-lg p-4" role="alert">
          <p>{error || 'No data available'}</p>
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => void load(period)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { current, previous, turnout } = data;
  const turnoutPct = turnoutPercent(turnout.counted, turnout.expected);
  const groups = typeGroups(data.by_type);
  const rows = data.recent_events;
  const truncated = current.events_held > rows.length;

  // The table holds the latest events only; the export fetches every event in
  // the period, so a spreadsheet totals to the figures above it.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await dashboardService.getCommunityEngagementEvents(period);
      downloadCsv(buildCsv(csvRows(all, tz)), `community-engagement-${period}-${getTodayLocalDate(tz)}.csv`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not export the outreach events'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl py-8" aria-busy={loading}>
      {header}

      <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={CalendarDays}
          label="Events held"
          value={formatNumber(current.events_held)}
          sub={`${formatNumber(data.upcoming_events)} more on the calendar`}
          change={changeFor(current, previous, 'events_held')}
          against={against}
        />
        <Kpi
          icon={Users}
          label="People reached"
          value={formatNumber(current.people_reached)}
          sub={`${formatNumber(current.counted)} counted · ${formatNumber(current.estimated)} estimated`}
          change={changeFor(current, previous, 'people_reached')}
          against={against}
        />
        <Kpi
          icon={Clock}
          label="Member hours"
          value={formatHours(current.member_hours)}
          sub={`given by ${formatNumber(current.members_involved)} ${current.members_involved === 1 ? 'member' : 'members'}`}
          change={changeFor(current, previous, 'member_hours')}
          against={against}
        />
        <Kpi
          icon={Inbox}
          label="Requests completed"
          value={formatNumber(current.requests_completed)}
          sub={`${formatNumber(current.requests_received)} received`}
          change={changeFor(current, previous, 'requests_completed')}
          against={against}
        />
      </div>
      <p className="text-theme-text-muted mb-5 text-xs">
        {against ? `Changes compare with ${against}. ` : ''}
        People reached is the guests counted — a headcount recorded on the event, or else guest sign-ins — and, where
        nothing was counted, the audience the requester expected. Members on duty are not counted.
      </p>

      <div className="mb-5 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-4" aria-labelledby="ce-reach-heading">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 id="ce-reach-heading" className="text-theme-text-primary text-sm font-semibold">
                People reached by {data.granularity}
              </h3>
              {turnoutPct != null && (
                <p className="text-theme-text-secondary mt-0.5 text-xs">
                  Where both were recorded, {formatNumber(turnout.counted)} counted against ~
                  {formatNumber(turnout.expected)} expected ({turnoutPct}%) across {turnout.events}{' '}
                  {turnout.events === 1 ? 'event' : 'events'}.
                </p>
              )}
            </div>
            <ReachLegend />
          </div>
          <ReachByPeriodChart buckets={data.by_period} narrow={phone} />
        </section>
        <section className="card p-4" aria-labelledby="ce-type-heading">
          <h3 id="ce-type-heading" className="text-theme-text-primary text-sm font-semibold">
            By type of outreach
          </h3>
          <p className="text-theme-text-muted mb-3 text-xs">People reached, {option?.label.toLowerCase()}</p>
          {groups.length ? (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.key}>
                  <h4 className="text-theme-text-secondary mb-2 text-xs font-semibold tracking-wider uppercase">
                    {g.title}
                  </h4>
                  <ReachByTypeBars slices={g.slices} />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-theme-text-muted text-sm">No outreach events held in this period.</p>
          )}
        </section>
      </div>

      <section className="card rwd-table-container overflow-hidden p-0" aria-labelledby="ce-events-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <h3 id="ce-events-heading" className="text-theme-text-primary text-sm font-semibold">
              Recent outreach events
            </h3>
            {truncated && (
              <p className="text-theme-text-muted text-xs">
                The latest {formatNumber(rows.length)} of {formatNumber(current.events_held)}; the export has them all.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/events/admin/community/print?period=${period}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary btn-sm flex items-center gap-1"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print summary</span>
            </a>
            <button
              type="button"
              className="btn-secondary btn-sm flex items-center gap-1"
              onClick={() => void exportCsv()}
              disabled={!rows.length || exporting}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
            </button>
          </div>
        </div>
        {!rows.length ? (
          <p className="text-theme-text-muted px-4 pb-4 text-sm">No outreach events held in this period.</p>
        ) : phone ? (
          <ul className="divide-theme-surface-border border-theme-surface-border divide-y border-t">
            {rows.map((r) => {
              const expected = expectedText(r);
              return (
                <li key={r.event_id}>
                  {/* The whole row is the link: the name alone was a 20px-tall target on a phone. */}
                  <Link
                    to={`/events/${r.event_id}`}
                    className="hover:bg-theme-surface-hover block px-4 py-3 text-sm focus-visible:outline-offset-[-2px]"
                  >
                    <span className="flex justify-between gap-3">
                      <span className="text-theme-text-primary min-w-0 font-medium">
                        {r.organization_name || r.title}
                      </span>
                      <span className="text-theme-text-muted shrink-0 text-xs">{eventDate(r, tz)}</span>
                    </span>
                    <span className="text-theme-text-secondary mt-0.5 flex justify-between gap-3 text-xs">
                      <span>
                        {r.type_label} · {r.crew} crew
                      </span>
                      <span className="text-right">
                        {reachText(r)}
                        {expected && <span className="text-theme-text-muted block">{expected}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <table className="rwd-table rwd-table-wide w-full text-sm" aria-labelledby="ce-events-heading">
            <thead className="bg-theme-surface-secondary text-theme-text-muted text-left text-xs uppercase">
              <tr>
                <th scope="col" className="px-4 py-2">
                  Date
                </th>
                <th scope="col" className="px-4 py-2">
                  Event
                </th>
                <th scope="col" className="px-4 py-2">
                  Type
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Reached
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Crew
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  Hours
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {rows.map((r) => {
                const expected = expectedText(r);
                return (
                  <tr key={r.event_id}>
                    <td data-label="Date" className="text-theme-text-muted px-4 py-2 whitespace-nowrap">
                      {eventDate(r, tz)}
                    </td>
                    <td data-label="Event" className="px-4 py-2">
                      <div className="min-w-0">
                        <Link
                          to={`/events/${r.event_id}`}
                          className="text-theme-text-primary font-medium hover:underline"
                        >
                          {r.organization_name || r.title}
                        </Link>
                        {r.organization_name && (
                          <div className="text-theme-text-muted text-xs">
                            {r.title}
                            {r.request_id && ' · from a public request'}
                          </div>
                        )}
                      </div>
                    </td>
                    <td data-label="Type" className="text-theme-text-secondary px-4 py-2">
                      {r.type_label}
                    </td>
                    <td data-label="Reached" className="text-theme-text-primary px-4 py-2 text-right tabular-nums">
                      <div className="min-w-0">
                        {reachText(r)}
                        {expected && <div className="text-theme-text-muted text-xs">{expected}</div>}
                      </div>
                    </td>
                    <td data-label="Crew" className="text-theme-text-secondary px-4 py-2 text-right tabular-nums">
                      {r.crew}
                    </td>
                    <td data-label="Hours" className="text-theme-text-secondary px-4 py-2 text-right tabular-nums">
                      {formatHours(r.member_hours)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

export default CommunityEngagementTab;
