import React from 'react';
import { formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

interface ElectionCloseStampProps {
  election: {
    status: string;
    end_date: string;
    closed_at?: string | null;
    closed_by_name?: string | null;
  };
  // The detail response carries closed_by_name; the list item does not, and
  // there "by whom" is simply not shown rather than guessed.
  showActor?: boolean;
  className?: string;
}

/**
 * When and by whom a closed election was actually closed. An early close used
 * to be dated to the scheduled end everywhere (W50-14); `closed_at` is the
 * real moment, `end_date` only the fallback for rows closed before it was
 * recorded. Renders nothing for an election that is not closed.
 */
const ElectionCloseStamp: React.FC<ElectionCloseStampProps> = ({ election, showActor = false, className }) => {
  const tz = useTimezone();
  if (election.status !== 'closed') return null;
  const actor = !showActor
    ? ''
    : election.closed_by_name
      ? ` by ${election.closed_by_name}`
      : ' — closed automatically at the scheduled end';
  return (
    <span className={className}>
      Closed {formatDateTime(election.closed_at || election.end_date, tz)}
      {actor}
    </span>
  );
};

export default ElectionCloseStamp;
