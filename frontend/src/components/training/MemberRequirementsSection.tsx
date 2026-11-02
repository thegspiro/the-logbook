/**
 * A member's training requirements and leaves of absence, for the training
 * officer reading that member's training page.
 *
 * Loads `/training/module-config/members/{id}/requirements`, which evaluates
 * the member exactly as their own My Training page does, and renders each
 * requirement with the same card. Its own request, so a failure here leaves
 * the training records below it working.
 */

import React, { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { trainingModuleConfigService } from '../../services/api';
import { RequirementDetailCard } from './RequirementDetailCard';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { LeaveMonthRule } from '../../constants/enums';
import type { MemberRequirementsResponse } from '../../types/training';

/** What the department's leave month rule means, in one sentence. */
const LEAVE_MONTH_RULE_SUMMARY: Record<string, string> = {
  [LeaveMonthRule.FULL_MONTH]: 'Any day of leave excuses the whole month.',
  [LeaveMonthRule.PROPORTIONAL]: 'A partly covered month is excused by the share of its days on leave.',
  [LeaveMonthRule.HALF]: '15 or more days of leave excuses half the month; a whole month excuses all of it.',
};

interface MemberRequirementsSectionProps {
  userId: string;
  timezone: string;
}

export const MemberRequirementsSection: React.FC<MemberRequirementsSectionProps> = ({ userId, timezone }) => {
  const [data, setData] = useState<MemberRequirementsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    trainingModuleConfigService
      .getMemberRequirements(userId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Unable to load this member’s requirements.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const summary = data?.requirements_summary;

  return (
    <section className="card mb-6 p-4" aria-labelledby="member-requirements-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="member-requirements-heading" className="text-theme-text-primary flex items-center gap-2 font-semibold">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
          Requirements
        </h2>
        {summary && summary.total_requirements > 0 && (
          <span className="text-theme-text-muted text-sm">
            {summary.met_requirements} of {summary.total_requirements} met
          </span>
        )}
      </div>

      {loading && <p className="text-theme-text-muted text-sm">Loading requirements…</p>}
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

      {data && (
        <>
          {data.leaves_of_absence.length > 0 && (
            <div className="mb-4 rounded-sm border border-blue-500/20 bg-blue-500/10 px-3 py-2">
              <p className="text-sm font-medium text-blue-700 dark:text-blue-300">Leave of absence</p>
              <ul className="mt-1 space-y-0.5">
                {data.leaves_of_absence.map((leave) => (
                  <li key={leave.id} className="text-xs text-blue-700 dark:text-blue-300">
                    <span className="capitalize">{leave.leave_type.replace(/_/g, ' ')}</span>:{' '}
                    {formatCalendarDate(leave.start_date)} –{' '}
                    {leave.end_date ? formatCalendarDate(leave.end_date) : 'no end date'}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                Training done during leave still counts. {LEAVE_MONTH_RULE_SUMMARY[data.leave_month_rule] ?? ''}
              </p>
            </div>
          )}

          {data.requirements_detail.length === 0 ? (
            <p className="text-theme-text-muted text-sm">No training requirements apply to this member.</p>
          ) : (
            <div className="space-y-3">
              {[...data.requirements_detail]
                .sort((a, b) => Number(a.is_met) - Number(b.is_met))
                .map((req) => (
                  <RequirementDetailCard key={req.id} requirement={req} timezone={timezone} audience="officer" />
                ))}
            </div>
          )}
        </>
      )}
    </section>
  );
};
