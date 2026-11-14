/**
 * The leaves of absence behind a reduced training target, with the
 * department's rule for how a month of leave counts.
 *
 * Shared by My Training and the training officer's view of a member, so the
 * two describe a leave the same way. A leave an officer marked exempt is
 * listed but says it does not reduce the target: the member keeps their
 * training requirements through it.
 */

import React from 'react';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { LeaveMonthRule } from '../../constants/enums';
import type { MemberLeavePeriod } from '../../types/training';

/** What the department's leave month rule means, in one sentence. */
const LEAVE_MONTH_RULE_SUMMARY: Record<string, string> = {
  [LeaveMonthRule.FULL_MONTH]: 'Any day of leave excuses the whole month.',
  [LeaveMonthRule.PROPORTIONAL]: 'A partly covered month is excused by the share of its days on leave.',
  [LeaveMonthRule.HALF]: '15 or more days of leave excuses half the month; a whole month excuses all of it.',
};

interface LeaveOfAbsenceSummaryProps {
  leaves: MemberLeavePeriod[];
  /** Absent from a server that predates the setting. */
  rule?: string | null | undefined;
}

export const LeaveOfAbsenceSummary: React.FC<LeaveOfAbsenceSummaryProps> = ({ leaves, rule }) => {
  if (leaves.length === 0) return null;
  const anyExcusing = leaves.some((leave) => leave.excuses_training !== false);
  return (
    <div className="mb-4 rounded-sm border border-blue-500/20 bg-blue-500/10 px-3 py-2">
      <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
        Leave of absence{leaves.length > 1 ? 's' : ''}
      </p>
      <ul className="mt-1 space-y-0.5">
        {leaves.map((leave) => (
          <li key={leave.id} className="text-xs text-blue-700 dark:text-blue-300">
            <span className="capitalize">{leave.leave_type.replace(/_/g, ' ')}</span>:{' '}
            {formatCalendarDate(leave.start_date)} –{' '}
            {leave.end_date ? formatCalendarDate(leave.end_date) : 'no end date'}
            {leave.excuses_training === false && <> (training requirements stay in force)</>}
          </li>
        ))}
      </ul>
      {anyExcusing && (
        <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
          Training done during leave still counts. {(rule && LEAVE_MONTH_RULE_SUMMARY[rule]) ?? ''}
        </p>
      )}
    </div>
  );
};
