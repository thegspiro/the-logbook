/**
 * Meeting Attendance Dashboard (secretary)
 *
 * Renders `GET /meetings/attendance/dashboard`: each active member's meeting
 * attendance over their own attendance window, with waivers and leave
 * excluded, and whether attendance blocks their vote. The server computes
 * every figure with the same calculation the ballot eligibility check uses,
 * so this screen displays them and derives nothing (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { GovernancePageHeader } from '../../../components/governance/GovernancePageHeader';
import { meetingsService } from '../../../services/meetingsServices';
import type { AttendanceDashboard } from '../../../services/meetingsServices';
import { getErrorMessage } from '../../../utils/errorHandling';
import { formatDateTime } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { EmptyState } from '../../../components/ux';
import type { MeetingType } from '../types/minutes';

const PERIOD_OPTIONS = [3, 6, 12, 24] as const;

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string }[] = [
  { value: 'business', label: 'Business' },
  { value: 'special', label: 'Special' },
  { value: 'committee', label: 'Committee' },
  { value: 'board', label: 'Board' },
  { value: 'trustee', label: 'Trustee' },
  { value: 'executive', label: 'Executive' },
  { value: 'annual', label: 'Annual' },
  { value: 'other', label: 'Other' },
];

const AttendanceDashboardPage: React.FC = () => {
  const tz = useTimezone();
  const [periodMonths, setPeriodMonths] = useState<number>(12);
  const [meetingType, setMeetingType] = useState<string>('');
  const [data, setData] = useState<AttendanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await meetingsService.getAttendanceDashboard({
        period_months: periodMonths,
        ...(meetingType ? { meeting_type: meetingType } : {}),
      });
      setData(result);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the attendance dashboard'));
    } finally {
      setLoading(false);
    }
  }, [periodMonths, meetingType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl">
      <GovernancePageHeader
        icon={Users}
        title="Meeting Attendance"
        breadcrumbLabel="Attendance"
        subtitle={
          <>
            Each active member&apos;s attendance since their service began, up to the period chosen. Waived meetings and
            meetings during a leave of absence are not counted against them.
          </>
        }
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <div>
          <label htmlFor="attendance-period" className="form-label">
            Period
          </label>
          <select
            id="attendance-period"
            value={periodMonths}
            onChange={(e) => setPeriodMonths(Number(e.target.value))}
            className="form-input"
          >
            {PERIOD_OPTIONS.map((months) => (
              <option key={months} value={months}>
                Last {months} months
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="attendance-meeting-type" className="form-label">
            Meeting type
          </label>
          <select
            id="attendance-meeting-type"
            value={meetingType}
            onChange={(e) => setMeetingType(e.target.value)}
            className="form-input"
          >
            <option value="">All types</option>
            {MEETING_TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading attendance</span>
        </div>
      ) : error ? (
        <div role="alert" className="alert-danger rounded-lg p-4">
          {error}
        </div>
      ) : data ? (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="card-secondary p-4">
              <p className="text-theme-text-muted text-sm">Meetings in period</p>
              <p className="text-theme-text-primary text-2xl font-bold">{data.total_meetings_in_period}</p>
            </div>
            <div className="card-secondary p-4">
              <p className="text-theme-text-muted text-sm">Average attendance</p>
              <p className="text-theme-text-primary text-2xl font-bold">{data.summary.avg_attendance_pct}%</p>
            </div>
            <div className="card-secondary p-4">
              <p className="text-theme-text-muted text-sm">Eligible to vote</p>
              <p className="text-theme-text-primary text-2xl font-bold">
                {data.summary.voting_eligible_count} of {data.summary.total_members}
              </p>
            </div>
            <div className="card-secondary p-4">
              <p className="text-theme-text-muted text-sm">Vote blocked by attendance</p>
              <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                {data.summary.voting_blocked_by_attendance}
              </p>
            </div>
          </div>

          {data.members.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No active members"
              description="Attendance is shown for active members only."
            />
          ) : (
            <div className="card overflow-hidden">
              <table className="rwd-table w-full text-sm">
                <thead>
                  <tr className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-secondary border-b text-left">
                    <th scope="col" className="px-4 py-3 font-medium">
                      Member
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Tier
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Attendance
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Attended
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Absent
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      Waived
                    </th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">
                      On leave
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Voting
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.user_id} className="border-theme-surface-border border-b last:border-b-0">
                      <td className="rwd-table-lead text-theme-text-primary px-4 py-3 font-medium" data-label="Member">
                        {m.name}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3" data-label="Tier">
                        {m.tier_name}
                      </td>
                      <td
                        className="text-theme-text-primary px-4 py-3 text-right font-semibold"
                        data-label="Attendance"
                      >
                        {m.eligible_meetings === 0 ? 'Not applicable' : `${m.attendance_pct}%`}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Attended">
                        {m.meetings_attended} of {m.eligible_meetings}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Absent">
                        {m.meetings_absent}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="Waived">
                        {m.meetings_waived}
                      </td>
                      <td className="text-theme-text-secondary px-4 py-3 text-right" data-label="On leave">
                        {m.meetings_on_leave}
                      </td>
                      <td className="px-4 py-3" data-label="Voting">
                        {m.voting_eligible ? (
                          <span className="text-green-800 dark:text-green-400">Eligible</span>
                        ) : (
                          <span className="text-red-700 dark:text-red-400">
                            Not eligible
                            {m.voting_blocked_reason && (
                              <span className="text-theme-text-muted block text-xs">{m.voting_blocked_reason}</span>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-theme-text-muted mt-3 text-xs">Calculated {formatDateTime(data.generated_at, tz)}.</p>
        </>
      ) : null}
    </div>
  );
};

export default AttendanceDashboardPage;
