/**
 * Elections › Meeting Attendance (secretary)
 *
 * How many meetings each member attended over a period the secretary picks,
 * whether they may vote in the election chosen, and -- one member at a time --
 * the meetings behind the count, with who recorded each one.
 *
 * Every figure comes from `GET /elections/{id}/attendance`: "may vote" is the
 * election's own eligibility roster, and each meeting is classified by the
 * same tally the ballot check uses, so this screen derives nothing
 * (CLAUDE.md pitfall #29). The period chosen here is for reading attendance;
 * it does not change the election's rules, which carry their own look-back.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronDown, ChevronRight, ClipboardCheck, Loader2 } from 'lucide-react';
import { GovernancePageHeader } from '../components/governance/GovernancePageHeader';
import { ElectionsAreaNav } from '../modules/elections/components/ElectionsAreaNav';
import { EmptyState } from '../components/ux';
import { StatGrid } from '../components/ux/StatGrid';
import { electionService } from '../services/api';
import type {
  AttendancePeriodQuery,
  ElectionAttendance,
  ElectionAttendanceMember,
  ElectionListItem,
  MeetingAttendanceStatus,
  MemberMeetings,
} from '../types/election';
import { ElectionStatus } from '../constants/enums';
import { MEETING_TYPE_OPTIONS } from '../modules/minutes/utils/meetingTypes';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate, formatTime, getTodayLocalDate } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { monthsBefore } from '../modules/elections/attendancePeriod';

const PERIOD_MONTHS = [3, 6, 12, 24] as const;
type PeriodChoice = (typeof PERIOD_MONTHS)[number] | 'custom';

const STATUS_LABELS: Record<MeetingAttendanceStatus, string> = {
  present: 'Attended',
  absent: 'Absent',
  excused: 'Excused',
  on_leave: 'On leave',
};

const STATUS_BADGES: Record<MeetingAttendanceStatus, string> = {
  present: 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100',
  absent: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100',
  excused: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  on_leave: 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white',
};

/** Backend `AttendanceRecordedVia`. */
const RECORDED_VIA_LABELS: Record<string, string> = {
  manual: 'Entered on the meeting',
  event_check_in: 'Event check-in',
  event_rsvp: 'Event RSVP',
  waiver: 'Waiver granted',
  waiver_request: 'Waiver request approved',
};

const MEETING_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  MEETING_TYPE_OPTIONS.map((option) => [option.value, option.label])
);

/** Elections whose voters are still being decided come first. */
const UNDECIDED: readonly string[] = [ElectionStatus.DRAFT, ElectionStatus.NOMINATIONS, ElectionStatus.OPEN];

const queryKey = (query: AttendancePeriodQuery): string => JSON.stringify(query);

interface MemberMeetingsListProps {
  electionId: string;
  member: ElectionAttendanceMember;
  query: AttendancePeriodQuery;
  tz: string;
}

/** One member's meetings over the period, loaded when the row is opened. */
const MemberMeetingsList: React.FC<MemberMeetingsListProps> = ({ electionId, member, query, tz }) => {
  const [data, setData] = useState<MemberMeetings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    electionService
      .getMemberMeetings(electionId, member.user_id, query)
      .then((result) => {
        if (current) setData(result);
      })
      .catch((err: unknown) => {
        if (current) setError(getErrorMessage(err, `Could not load ${member.name}'s meetings`));
      });
    return () => {
      current = false;
    };
  }, [electionId, member.user_id, member.name, query]);

  if (error) {
    return (
      <p role="alert" className="alert-danger rounded-md p-3 text-sm">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="text-theme-text-muted flex items-center gap-2 text-sm" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading meetings
      </p>
    );
  }
  if (data.meetings.length === 0) {
    return <p className="text-theme-text-muted text-sm">No meetings in this period count for {member.name}.</p>;
  }
  return (
    <ul className="divide-theme-surface-border divide-y" aria-label={`Meetings for ${member.name}`}>
      {data.meetings.map((meeting) => {
        const details: string[] = [];
        if (meeting.checked_in_at) details.push(`Checked in ${formatTime(meeting.checked_in_at, tz)}`);
        if (meeting.recorded_by_name) details.push(`Recorded by ${meeting.recorded_by_name}`);
        if (meeting.recorded_via) details.push(RECORDED_VIA_LABELS[meeting.recorded_via] ?? meeting.recorded_via);
        if (meeting.waiver_reason) details.push(`Reason: ${meeting.waiver_reason}`);
        if (meeting.status === 'on_leave' && meeting.leave_start) {
          details.push(
            meeting.leave_end
              ? `Leave ${formatDate(meeting.leave_start, tz)} to ${formatDate(meeting.leave_end, tz)}`
              : `Leave from ${formatDate(meeting.leave_start, tz)}`
          );
        }
        return (
          <li key={meeting.meeting_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <p className="text-theme-text-primary text-sm font-medium">{meeting.title}</p>
              <p className="text-theme-text-muted text-xs">
                {formatDate(meeting.meeting_date, tz)}
                {meeting.meeting_type && ` · ${MEETING_TYPE_LABELS[meeting.meeting_type] ?? meeting.meeting_type}`}
              </p>
              {details.length > 0 && <p className="text-theme-text-secondary text-xs">{details.join(' · ')}</p>}
            </div>
            <span className={`badge ${STATUS_BADGES[meeting.status]}`}>{STATUS_LABELS[meeting.status]}</span>
          </li>
        );
      })}
    </ul>
  );
};

const ElectionAttendancePage: React.FC = () => {
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  const electionParam = searchParams.get('election');

  const [elections, setElections] = useState<ElectionListItem[] | null>(null);
  const [electionsError, setElectionsError] = useState<string | null>(null);

  const today = getTodayLocalDate(tz);
  const [period, setPeriod] = useState<PeriodChoice>(12);
  const [customStart, setCustomStart] = useState(() => monthsBefore(today, 12));
  const [customEnd, setCustomEnd] = useState(today);
  const [meetingTypes, setMeetingTypes] = useState<string[]>([]);

  const [data, setData] = useState<ElectionAttendance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    electionService
      .getElections()
      .then((list) => setElections(list.filter((e) => e.status !== ElectionStatus.CANCELLED)))
      .catch((err: unknown) => setElectionsError(getErrorMessage(err, 'Could not load the elections')));
  }, []);

  const electionId = useMemo(() => {
    if (!elections) return null;
    if (electionParam && elections.some((e) => e.id === electionParam)) return electionParam;
    return (elections.find((e) => UNDECIDED.includes(e.status)) ?? elections[0])?.id ?? null;
  }, [elections, electionParam]);

  const rangeError =
    period !== 'custom'
      ? null
      : !customStart || !customEnd
        ? 'Choose both dates.'
        : customStart > customEnd
          ? 'The start date is after the end date.'
          : null;

  // Stable across renders so an opened member's list reloads only when the
  // period or meeting types actually change.
  const queryText = queryKey({
    start: period === 'custom' ? customStart : monthsBefore(today, period),
    end: period === 'custom' ? customEnd : today,
    meeting_type: meetingTypes.length > 0 ? meetingTypes : undefined,
  });
  const query = useMemo(() => JSON.parse(queryText) as AttendancePeriodQuery, [queryText]);

  const load = useCallback(async () => {
    if (!electionId || rangeError) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await electionService.getElectionAttendance(electionId, query);
      // A slower answer for an earlier choice must not replace the current one.
      if (id === requestId.current) setData(result);
    } catch (err: unknown) {
      if (id === requestId.current) setError(getErrorMessage(err, 'Could not load meeting attendance'));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [electionId, query, rangeError]);

  useEffect(() => {
    setExpanded(null);
    void load();
  }, [load]);

  const toggleType = (value: string) =>
    setMeetingTypes((current) => (current.includes(value) ? current.filter((t) => t !== value) : [...current, value]));

  const chooseElection = (id: string) => setSearchParams({ election: id }, { replace: true });

  const mayVote = data ? data.members.filter((m) => m.may_vote === true).length : 0;

  return (
    <div className="mx-auto max-w-7xl">
      <GovernancePageHeader
        icon={ClipboardCheck}
        title="Meeting Attendance"
        breadcrumbLabel="Meeting Attendance"
        subtitle="How many meetings each member attended, and whether they may vote in the election you choose"
      />
      <ElectionsAreaNav />

      {electionsError ? (
        <div role="alert" className="alert-danger rounded-lg p-4">
          {electionsError}
        </div>
      ) : !elections ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading elections</span>
        </div>
      ) : elections.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No elections yet"
          description="Attendance is read against an election's voter rules. Create an election first."
        />
      ) : (
        <>
          <div className="card mb-6 space-y-4 p-4">
            <div className="flex flex-wrap gap-4">
              <div className="min-w-0 flex-1 sm:max-w-sm">
                <label htmlFor="attendance-election" className="form-label">
                  Election
                </label>
                <select
                  id="attendance-election"
                  value={electionId ?? ''}
                  onChange={(e) => chooseElection(e.target.value)}
                  className="form-input"
                >
                  {elections.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="attendance-period" className="form-label">
                  Period
                </label>
                <select
                  id="attendance-period"
                  value={String(period)}
                  onChange={(e) =>
                    setPeriod(e.target.value === 'custom' ? 'custom' : (Number(e.target.value) as PeriodChoice))
                  }
                  className="form-input"
                >
                  {PERIOD_MONTHS.map((months) => (
                    <option key={months} value={months}>
                      Last {months} months
                    </option>
                  ))}
                  <option value="custom">Custom dates</option>
                </select>
              </div>
              {period === 'custom' && (
                <>
                  <div>
                    <label htmlFor="attendance-from" className="form-label">
                      From
                    </label>
                    <input
                      id="attendance-from"
                      type="date"
                      value={customStart}
                      max={customEnd || undefined}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="form-input"
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? 'attendance-range-error' : undefined}
                    />
                  </div>
                  <div>
                    <label htmlFor="attendance-to" className="form-label">
                      To
                    </label>
                    <input
                      id="attendance-to"
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="form-input"
                      aria-invalid={rangeError ? true : undefined}
                      aria-describedby={rangeError ? 'attendance-range-error' : undefined}
                    />
                  </div>
                </>
              )}
            </div>
            {rangeError && (
              <p id="attendance-range-error" role="alert" className="text-sm text-red-700 dark:text-red-400">
                {rangeError}
              </p>
            )}
            <fieldset>
              <legend className="form-label">Meeting types</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MEETING_TYPE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="text-theme-text-secondary touch-target-phone inline-flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={meetingTypes.includes(option.value)}
                      onChange={() => toggleType(option.value)}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <p className="text-theme-text-muted mt-1 text-xs">
                {meetingTypes.length === 0 ? 'Counting every type of meeting.' : 'Counting the checked types only.'}
              </p>
            </fieldset>
          </div>

          {loading && !data ? (
            <div className="flex justify-center py-12" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
              <span className="sr-only">Loading attendance</span>
            </div>
          ) : error ? (
            <div role="alert" className="alert-danger rounded-lg p-4">
              {error}
            </div>
          ) : data ? (
            <div aria-busy={loading}>
              <StatGrid columns={3} gap={4} className="mb-6">
                <div className="card-secondary p-4">
                  <p className="text-theme-text-muted text-sm">Meetings in period</p>
                  <p className="text-theme-text-primary text-2xl font-bold" data-testid="attendance-total-meetings">
                    {data.total_meetings}
                  </p>
                  <p className="text-theme-text-muted text-xs">
                    {formatDate(data.start, tz)} to {formatDate(data.end, tz)}
                  </p>
                </div>
                <div className="card-secondary p-4">
                  <p className="text-theme-text-muted text-sm">May vote in this election</p>
                  <p className="text-theme-text-primary text-2xl font-bold" data-testid="attendance-may-vote">
                    {mayVote} of {data.members.length}
                  </p>
                </div>
                <div className="card-secondary p-4">
                  <p className="text-theme-text-muted text-sm">Voter rules</p>
                  <p className="text-theme-text-secondary text-sm">
                    The election&apos;s rules count their own meetings, whatever period is shown here.{' '}
                    <Link
                      to={`/elections/${data.election_id}/eligibility`}
                      className="text-theme-text-primary font-medium underline"
                    >
                      See this election&apos;s rules
                    </Link>
                  </p>
                </div>
              </StatGrid>

              {data.members.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No active members"
                  description="Attendance is shown for active members."
                />
              ) : (
                <div className="card rwd-table-container overflow-hidden">
                  <table className="rwd-table rwd-table-wide w-full text-sm">
                    <thead>
                      <tr className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-secondary border-b text-left">
                        <th scope="col" className="px-4 py-3 font-medium">
                          Member
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">
                          Attended
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">
                          Excused
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">
                          On leave
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          May vote
                        </th>
                        <th scope="col" className="px-4 py-3 font-medium">
                          <span className="sr-only">Meetings</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.members.map((m) => {
                        const open = expanded === m.user_id;
                        const panelId = `attendance-meetings-${m.user_id}`;
                        return (
                          <React.Fragment key={m.user_id}>
                            <tr className="border-theme-surface-border border-b last:border-b-0">
                              <td className="rwd-table-lead px-4 py-3" data-label="Member">
                                <span className="text-theme-text-primary font-medium">{m.name}</span>
                                {(m.member_type || m.member_since) && (
                                  <span className="text-theme-text-muted block text-xs">
                                    {[m.member_type, m.member_since && `since ${formatDate(m.member_since, tz)}`]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                )}
                              </td>
                              <td className="text-theme-text-primary px-4 py-3 text-right" data-label="Attended">
                                {m.attended + m.absent === 0 ? (
                                  'Not applicable'
                                ) : (
                                  <>
                                    {m.attended} of {m.attended + m.absent}
                                    <span className="text-theme-text-muted block text-xs">{m.attendance_pct}%</span>
                                  </>
                                )}
                              </td>
                              <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Excused">
                                {m.excused}
                              </td>
                              <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="On leave">
                                {m.on_leave}
                              </td>
                              <td className="px-4 py-3" data-label="May vote">
                                {m.may_vote === true ? (
                                  <span className="text-green-800 dark:text-green-400">Yes</span>
                                ) : m.may_vote === false ? (
                                  <span className="text-red-700 dark:text-red-400">
                                    No
                                    {m.reason && (
                                      <span className="text-theme-text-muted block text-xs">{m.reason}</span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-theme-text-muted">Not on the roster</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right" data-label="Meetings">
                                <button
                                  type="button"
                                  className="btn-secondary inline-flex items-center gap-1 text-sm"
                                  aria-label={`Meetings for ${m.name}`}
                                  aria-expanded={open}
                                  aria-controls={open ? panelId : undefined}
                                  onClick={() => setExpanded(open ? null : m.user_id)}
                                >
                                  {open ? (
                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  Meetings
                                </button>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-theme-surface-border bg-theme-surface-secondary border-b">
                                <td
                                  colSpan={6}
                                  className="px-4 py-3"
                                  id={panelId}
                                  data-label={`Meetings for ${m.name}`}
                                >
                                  <MemberMeetingsList electionId={data.election_id} member={m} query={query} tz={tz} />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-theme-text-muted mt-3 text-xs">
                Excused meetings and meetings during a leave of absence are not counted against a member. Meetings
                before a member joined are left out.
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default ElectionAttendancePage;
