/**
 * Records of deleted evaluations: who deleted which, when, and why. The
 * evaluation itself is gone; this trace of it never is.
 */
import React from 'react';
import { useTimezone } from '../../../../hooks/useTimezone';
import { formatCalendarDate, formatDateTime } from '../../../../utils/dateFormatting';
import type { EvaluationDeletionRecord } from '../../types/evaluations';

interface DeletionRecordListProps {
  records: EvaluationDeletionRecord[];
  /** Name the member on each record; off on a member's own page. */
  showMember: boolean;
}

export const DeletionRecordList: React.FC<DeletionRecordListProps> = ({ records, showMember }) => {
  const tz = useTimezone();
  return (
    <ul className="divide-theme-surface-border card divide-y">
      {records.map((record) => (
        <li key={record.id} className="space-y-1 p-4 text-sm">
          <p className="text-theme-text-primary font-medium">
            {showMember ? `${record.member.name} · ` : ''}
            {record.period_name ??
              `${formatCalendarDate(record.period_start)} – ${formatCalendarDate(record.period_end)}`}
            <span className="text-theme-text-secondary font-normal"> · {record.template_name}</span>
          </p>
          <p className="text-theme-text-secondary">
            {record.was_finalized ? 'A finalized evaluation' : 'An evaluation in progress'}
            {record.evaluator_name ? `, evaluated by ${record.evaluator_name}` : ''}, deleted by{' '}
            {record.deleted_by_name} on {formatDateTime(record.deleted_at, tz)}.
          </p>
          <p className="text-theme-text-primary whitespace-pre-line">
            <span className="text-theme-text-secondary">Reason: </span>
            {record.reason}
          </p>
        </li>
      ))}
    </ul>
  );
};
