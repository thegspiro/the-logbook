/**
 * The Outreach Impact report as a page a chief can hand to a board.
 *
 * A print view rather than a generated PDF, like the app's other reports: the
 * browser's own print-to-PDF turns it into a file without a second rendering
 * stack to keep in step with the screen.
 *
 * Every figure is one the two report endpoints returned (pitfall #29): the
 * totals and breakdowns from the report, and the event list from the same
 * endpoint the CSV export reads, so the list totals to the figures above it.
 * The screen's charts are not reused. They take their colours from the theme,
 * which in dark mode is white text on white paper, and they rely on hover; the
 * breakdowns here are tables with plain grey bars instead.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import PrintPageStyles from '../../components/print/PrintPageStyles';
import { dashboardService } from '../../services/api';
import type { CommunityEngagement, CommunityEventReach } from '../../services/api';
import type { CrrImpact, CrrImpactCount } from '../../services/communicationsServices';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom, formatNumber } from '../../utils/dateFormatting';
import { formatHours } from '../../utils/hoursFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { isValidLogoUrl } from '../../utils/logoUrl';
import {
  COMMUNITY_PERIODS,
  allTypesIn,
  bucketLabel,
  changeFor,
  eventDate,
  feedbackText,
  parseCommunityPeriod,
  periodRangeText,
  reachText,
  turnoutPercent,
  type ComparableFigure,
} from './communityEngagement';

/** "1 activity", "14 activities". */
const activitiesText = (n: number): string => `${formatNumber(n)} ${n === 1 ? 'activity' : 'activities'}`;

const PAPER: React.CSSProperties = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  color: '#111',
  fontSize: '10pt',
  lineHeight: 1.5,
};
const SECTION: React.CSSProperties = {
  fontSize: '12pt',
  fontWeight: 'bold',
  margin: '14pt 0 6pt 0',
  borderBottom: '1pt solid #111',
  paddingBottom: '2pt',
};
const TABLE: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '9pt' };
const CELL: React.CSSProperties = {
  border: '0.5pt solid #999',
  padding: '3pt 5pt',
  textAlign: 'left',
  verticalAlign: 'top',
};
const NUM: React.CSSProperties = { ...CELL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const HEAD: React.CSSProperties = { ...CELL, fontWeight: 'bold', background: '#eee' };
const HEAD_NUM: React.CSSProperties = { ...HEAD, textAlign: 'right' };
const NOTE: React.CSSProperties = { fontSize: '8.5pt', color: '#444', margin: '4pt 0 0 0' };

/** A grey bar as wide as *value* is of *max*; decoration beside the number it shows. */
const Bar: React.FC<{ value: number; max: number }> = ({ value, max }) => (
  <div aria-hidden="true" style={{ background: '#eee', height: '7pt', width: '100%' }}>
    <div
      style={{
        background: '#555',
        height: '100%',
        width: `${max > 0 ? Math.round((value / max) * 100) : 0}%`,
        printColorAdjust: 'exact',
        WebkitPrintColorAdjust: 'exact',
      }}
    />
  </div>
);

/**
 * Lets a wide table scroll sideways on a phone instead of widening the page,
 * as the testing report does. Printing is unaffected: the paper is wider.
 */
const TableScroll: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="overflow-x-auto" data-mobile-scroll-region role="region" aria-label={label} tabIndex={0}>
    {children}
  </div>
);

/** "Smoke alarm install · Alarms installed 5; Homes 2": a group's counts on one line. */
const countsText = (counts: CrrImpactCount[]): string =>
  counts.map((c) => `${c.activity_type_name} · ${c.label} ${formatNumber(c.quantity)}`).join('; ');

/**
 * The CRR breakdowns as tables, without the screen's map: a street map does
 * not print reliably, and the ZIP table carries the same figures.
 */
const CrrPrintSection: React.FC<{ crr: CrrImpact }> = ({ crr }) => (
  <>
    <h2 style={SECTION}>Community risk reduction</h2>
    {crr.activities === 0 ? (
      <p style={{ margin: 0 }}>No CRR activities were recorded in this period.</p>
    ) : (
      <>
        <TableScroll label="CRR activities by type">
          <table style={{ ...TABLE, marginBottom: '8pt' }}>
            <caption style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '10pt', padding: '0 0 3pt 0' }}>
              By activity ({activitiesText(crr.activities)})
            </caption>
            <thead>
              <tr>
                <th scope="col" style={HEAD}>
                  Activity
                </th>
                <th scope="col" style={HEAD_NUM}>
                  Activities
                </th>
                <th scope="col" style={HEAD}>
                  Counts
                </th>
              </tr>
            </thead>
            <tbody>
              {crr.by_type
                .filter((t) => t.activities > 0)
                .map((t) => (
                  <tr key={t.activity_type_id}>
                    <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                      {t.name}
                    </th>
                    <td style={NUM}>{formatNumber(t.activities)}</td>
                    <td style={CELL}>
                      {t.counts
                        .filter((c) => c.quantity > 0)
                        .map((c) => `${c.label} ${formatNumber(c.quantity)}`)
                        .join('; ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableScroll>
        {crr.by_tag.length > 0 && (
          <TableScroll label="CRR activities by risk and population">
            <table style={{ ...TABLE, marginBottom: '8pt' }}>
              <caption style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '10pt', padding: '0 0 3pt 0' }}>
                By risk and priority population (an activity counts under each of its tags)
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={HEAD}>
                    Tag
                  </th>
                  <th scope="col" style={HEAD_NUM}>
                    Activities
                  </th>
                  <th scope="col" style={HEAD}>
                    Counts
                  </th>
                </tr>
              </thead>
              <tbody>
                {crr.by_tag.map((t) => (
                  <tr key={t.tag_id}>
                    <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                      {t.label} ({t.kind === 'risk' ? 'risk' : 'population'})
                    </th>
                    <td style={NUM}>{formatNumber(t.activities)}</td>
                    <td style={CELL}>{countsText(t.counts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        {crr.by_zip.length > 0 && (
          <TableScroll label="CRR activities by ZIP code">
            <table style={{ ...TABLE, marginBottom: '8pt' }}>
              <caption style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '10pt', padding: '0 0 3pt 0' }}>
                By ZIP code
                {crr.unplaced_activities > 0 ? ` (${activitiesText(crr.unplaced_activities)} had no ZIP code)` : ''}
              </caption>
              <thead>
                <tr>
                  <th scope="col" style={HEAD}>
                    ZIP code
                  </th>
                  <th scope="col" style={HEAD_NUM}>
                    Activities
                  </th>
                  <th scope="col" style={HEAD}>
                    Counts
                  </th>
                </tr>
              </thead>
              <tbody>
                {crr.by_zip.map((z) => (
                  <tr key={z.zip_code}>
                    <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                      {z.zip_code}
                      {z.city || z.state ? ` ${[z.city, z.state].filter(Boolean).join(', ')}` : ''}
                    </th>
                    <td style={NUM}>{formatNumber(z.activities)}</td>
                    <td style={CELL}>{countsText(z.counts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </>
    )}
  </>
);

interface Headline {
  label: string;
  value: string;
  detail?: string | undefined;
  figure?: ComparableFigure | undefined;
  /** The same figure for the previous period; absent for all time. */
  previous?: string | undefined;
}

const CommunityEngagementPrintPage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams] = useSearchParams();
  const period = parseCommunityPeriod(searchParams.get('period'));
  const option = COMMUNITY_PERIODS.find((p) => p.value === period) ?? COMMUNITY_PERIODS[0];

  const [report, setReport] = useState<CommunityEngagement | null>(null);
  const [events, setEvents] = useState<CommunityEventReach[]>([]);
  const [department, setDepartment] = useState<{ name?: string | undefined; logo?: string | undefined }>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [data, all] = await Promise.all([
          dashboardService.getCommunityEngagement(period),
          dashboardService.getCommunityEngagementEvents(period),
        ]);
        if (!cancelled) {
          setReport(data);
          setEvents(all);
        }
      } catch (err: unknown) {
        if (!cancelled) setLoadError(getErrorMessage(err, 'The community engagement report could not be loaded'));
      }
    })();
    // The name and logo are decoration: a failure leaves the heading plain
    // rather than holding the report back.
    dashboardService
      .getBranding()
      .then(({ name, logo }) => {
        if (!cancelled) setDepartment({ name, logo: logo && isValidLogoUrl(logo) ? logo : undefined });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [period]);

  useEffect(() => {
    // Printed once the report has loaded, never over an empty or failed page:
    // a blank summary sent to the printer reads as a year with no outreach.
    if (!report) return undefined;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [report]);

  if (loadError) {
    return (
      <div style={{ padding: '2rem' }} role="alert">
        <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 8pt 0' }}>The summary could not be loaded</h1>
        <p style={{ margin: '0 0 8pt 0' }}>{loadError}</p>
        <p style={{ margin: 0 }}>
          Nothing has been printed. Reload the page, or go back to Outreach Impact and try again.
        </p>
      </div>
    );
  }

  if (!report) {
    return (
      <p style={{ padding: '2rem' }} role="status">
        Loading the summary…
      </p>
    );
  }

  const { current, previous, turnout } = report;
  const against = option?.previous ?? null;
  const turnoutPct = turnoutPercent(turnout.counted, turnout.expected);
  const groups = (
    [
      { key: 'request', title: 'Public requests' },
      { key: 'department', title: 'Department events' },
    ] as const
  )
    .map((g) => ({ ...g, types: allTypesIn(report.by_type, g.key) }))
    .filter((g) => g.types.length > 0);
  const peakMonth = Math.max(0, ...report.by_period.map((b) => b.counted + b.estimated));

  const headlines: Headline[] = [
    {
      label: 'Events held',
      value: formatNumber(current.events_held),
      figure: 'events_held',
      previous: previous ? formatNumber(previous.events_held) : undefined,
    },
    {
      label: 'People reached',
      value: formatNumber(current.people_reached),
      detail: `${formatNumber(current.counted)} counted, ${formatNumber(current.estimated)} estimated`,
      figure: 'people_reached',
      previous: previous ? formatNumber(previous.people_reached) : undefined,
    },
    {
      label: 'Member hours',
      value: formatHours(current.member_hours),
      detail: `given by ${formatNumber(current.members_involved)} ${current.members_involved === 1 ? 'member' : 'members'}`,
      figure: 'member_hours',
      previous: previous ? formatHours(previous.member_hours) : undefined,
    },
    {
      label: 'Requests completed',
      value: formatNumber(current.requests_completed),
      detail: `${formatNumber(current.requests_received)} received`,
      figure: 'requests_completed',
      previous: previous ? formatNumber(previous.requests_completed) : undefined,
    },
  ];
  // Listed only once a requester has answered: a row reading "no feedback"
  // in every summary before the department asks for any is noise.
  if ((current.feedback_responses ?? 0) > 0 || (previous?.feedback_responses ?? 0) > 0) {
    headlines.push({
      label: 'Requester feedback',
      value: feedbackText(current, report.rating_scale_max) ?? 'None',
      previous: previous ? (feedbackText(previous, report.rating_scale_max) ?? 'None') : undefined,
    });
  }

  return (
    <>
      <PrintPageStyles margin="0.5in 0.6in" />

      <div className="mx-auto my-8 max-w-[8.5in] bg-white shadow-lg print:my-0 print:shadow-none">
        <div className="p-8 print:p-0" style={PAPER}>
          <header
            style={{
              borderBottom: '3px solid #111',
              paddingBottom: '10pt',
              marginBottom: '12pt',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '12pt',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10pt' }}>
              {department.logo && (
                <img src={department.logo} alt="" style={{ height: '42pt', width: 'auto', objectFit: 'contain' }} />
              )}
              <div>
                {department.name && <p style={{ fontSize: '11pt', margin: 0 }}>{department.name}</p>}
                <h1 style={{ fontSize: '18pt', fontWeight: 'bold', margin: '0 0 2pt 0' }}>Outreach Impact Summary</h1>
                <p style={{ fontSize: '11pt', margin: 0 }}>
                  {option?.label} · {periodRangeText(report.period_start, report.period_end, tz)}
                </p>
              </div>
            </div>
            <p style={{ textAlign: 'right', fontSize: '9pt', color: '#666', margin: 0 }}>
              Prepared {formatDateCustom(new Date(), { month: 'long', day: 'numeric', year: 'numeric' }, tz)}
            </p>
          </header>

          <h2 style={SECTION}>At a glance</h2>
          <TableScroll label="Headline figures">
            <table style={TABLE}>
              <thead>
                <tr>
                  <th scope="col" style={HEAD}>
                    Figure
                  </th>
                  <th scope="col" style={HEAD_NUM}>
                    {option?.label}
                  </th>
                  {previous && (
                    <>
                      <th scope="col" style={HEAD_NUM}>
                        Previous
                      </th>
                      <th scope="col" style={HEAD_NUM}>
                        Change
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {headlines.map((h) => {
                  const change = h.figure ? changeFor(current, previous, h.figure) : null;
                  return (
                    <tr key={h.label}>
                      <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                        {h.label}
                        {h.detail && <div style={{ fontSize: '8pt', color: '#555' }}>{h.detail}</div>}
                      </th>
                      <td style={NUM}>{h.value}</td>
                      {previous && (
                        <>
                          <td style={NUM}>{h.previous ?? '—'}</td>
                          <td style={NUM}>{change?.text ?? '—'}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <p style={NOTE}>
            {against ? `Previous is ${against}. ` : ''}People reached is the guests counted (a headcount recorded on the
            event, or else guest sign-ins) and, where nothing was counted, the audience the requester expected. Members
            on duty are not counted.
            {turnoutPct != null &&
              ` Where both were recorded, ${formatNumber(turnout.counted)} were counted against about ${formatNumber(
                turnout.expected
              )} expected (${turnoutPct}%) across ${formatNumber(turnout.events)} ${
                turnout.events === 1 ? 'event' : 'events'
              }.`}
          </p>

          {report.by_period.length > 0 && (
            <>
              <h2 style={SECTION}>People reached by {report.granularity}</h2>
              <TableScroll label={`People reached by ${report.granularity}`}>
                <table style={TABLE}>
                  <thead>
                    <tr>
                      <th scope="col" style={HEAD}>
                        {report.granularity === 'year' ? 'Year' : 'Month'}
                      </th>
                      <th scope="col" style={HEAD_NUM}>
                        Events
                      </th>
                      <th scope="col" style={HEAD_NUM}>
                        Counted
                      </th>
                      <th scope="col" style={HEAD_NUM}>
                        Estimated
                      </th>
                      <th scope="col" style={{ ...HEAD, width: '30%' }}>
                        <span className="sr-only">Share of the busiest {report.granularity}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_period.map((b) => (
                      <tr key={b.period}>
                        <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                          {bucketLabel(b.period, true)}
                        </th>
                        <td style={NUM}>{formatNumber(b.events)}</td>
                        <td style={NUM}>{formatNumber(b.counted)}</td>
                        <td style={NUM}>{formatNumber(b.estimated)}</td>
                        <td style={{ ...CELL, verticalAlign: 'middle' }}>
                          <Bar value={b.counted + b.estimated} max={peakMonth} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </>
          )}

          <h2 style={SECTION}>By type of outreach</h2>
          {groups.length === 0 ? (
            <p style={{ margin: 0 }}>No outreach events were held in this period.</p>
          ) : (
            groups.map((g) => {
              const peak = Math.max(0, ...g.types.map((t) => t.people_reached));
              return (
                <TableScroll key={g.key} label={g.title}>
                  <table style={{ ...TABLE, marginBottom: '8pt' }}>
                    <caption style={{ textAlign: 'left', fontWeight: 'bold', fontSize: '10pt', padding: '0 0 3pt 0' }}>
                      {g.title}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" style={HEAD}>
                          Type
                        </th>
                        <th scope="col" style={HEAD_NUM}>
                          Events
                        </th>
                        <th scope="col" style={HEAD_NUM}>
                          People reached
                        </th>
                        <th scope="col" style={{ ...HEAD, width: '30%' }}>
                          <span className="sr-only">Share of the largest type</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.types.map((t) => (
                        <tr key={t.label}>
                          <th scope="row" style={{ ...CELL, fontWeight: 'normal' }}>
                            {t.label}
                          </th>
                          <td style={NUM}>{formatNumber(t.events)}</td>
                          <td style={NUM}>{formatNumber(t.people_reached)}</td>
                          <td style={{ ...CELL, verticalAlign: 'middle' }}>
                            <Bar value={t.people_reached} max={peak} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              );
            })
          )}

          {report.crr && <CrrPrintSection crr={report.crr} />}

          <h2 style={SECTION}>Outreach events</h2>
          {events.length === 0 ? (
            <p style={{ margin: 0 }}>No outreach events were held in this period.</p>
          ) : (
            <TableScroll label="Outreach events">
              <table style={TABLE}>
                <thead>
                  <tr>
                    <th scope="col" style={HEAD}>
                      Date
                    </th>
                    <th scope="col" style={HEAD}>
                      Event
                    </th>
                    <th scope="col" style={HEAD}>
                      Type
                    </th>
                    <th scope="col" style={HEAD_NUM}>
                      Reach
                    </th>
                    <th scope="col" style={HEAD_NUM}>
                      Crew
                    </th>
                    <th scope="col" style={HEAD_NUM}>
                      Member hours
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((r) => (
                    <tr key={r.event_id} style={{ breakInside: 'avoid' }}>
                      <td style={{ ...CELL, whiteSpace: 'nowrap' }}>{eventDate(r, tz)}</td>
                      <td style={CELL}>
                        {r.title}
                        {r.organization_name && (
                          <div style={{ fontSize: '8pt', color: '#555' }}>Requested by {r.organization_name}</div>
                        )}
                      </td>
                      <td style={CELL}>{r.type_label}</td>
                      <td style={NUM}>{reachText(r)}</td>
                      <td style={NUM}>{formatNumber(r.crew)}</td>
                      <td style={NUM}>{formatHours(r.member_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      </div>
    </>
  );
};

export default CommunityEngagementPrintPage;
