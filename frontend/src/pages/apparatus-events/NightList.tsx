/**
 * The coordinator's nights. "Needs confirmation" is every night that has
 * ended without its attendance being finalized: finalizing on the event page
 * is what confirms the crew and posts their hours to Admin Hours, so each row
 * leads there rather than to a second copy of that step.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck } from 'lucide-react';
import { apparatusEventService } from '../../services/api';
import type { NightScope, NightSummary } from '../../types/apparatusEvent';
import { EmptyState, SkeletonCardGrid } from '../../components/ux';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { TONE } from './tones';

const EMPTY: Record<NightScope, { title: string; description: string }> = {
  upcoming: {
    title: 'No nights coming up',
    description: 'Schedule nights from a template and they appear here with how many seats are filled.',
  },
  needs_confirmation: {
    title: 'Nothing waiting',
    description: 'Every night that has ended has had its crew confirmed and its hours posted.',
  },
  past: {
    title: 'No past nights yet',
    description: 'Nights appear here once their crew is confirmed, or if they were cancelled.',
  },
};

const fillTone = (row: NightSummary): string => {
  if (row.total === 0) return TONE.slate;
  if (row.filled >= row.total) return TONE.green;
  return row.total - row.filled === 1 ? TONE.amber : TONE.red;
};

export const NightList: React.FC<{ scope: NightScope }> = ({ scope }) => {
  const tz = useTimezone();
  const [rows, setRows] = useState<NightSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await apparatusEventService.listNights(scope));
    } catch (err) {
      setError(getErrorMessage(err, 'Could not load the nights.'));
      setRows([]);
    }
  }, [scope]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  if (rows === null) return <SkeletonCardGrid count={3} />;
  if (error) {
    return (
      <div className="alert-danger text-sm" role="alert">
        {error}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={scope === 'needs_confirmation' ? CheckCircle2 : CalendarDays}
        title={EMPTY[scope].title}
        description={EMPTY[scope].description}
        compact
      />
    );
  }

  return (
    <ul className="card divide-theme-surface-border divide-y overflow-hidden">
      {rows.map((row) => (
        <li key={row.event_id}>
          <Link
            to={`/events/${row.event_id}`}
            className="hover:bg-theme-surface-hover focus-visible:ring-theme-focus-ring flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1">
              <p className="text-theme-text-primary truncate font-semibold">{row.title}</p>
              <p className="text-theme-text-muted text-sm">
                {formatDate(row.start_datetime, tz)} · {formatTime(row.start_datetime, tz)} –{' '}
                {formatTime(row.end_datetime, tz)}
                {row.unit_numbers.length > 0 ? ` · ${row.unit_numbers.join(' + ')}` : ''}
                {row.template_name ? ` · ${row.template_name}` : ''}
              </p>
            </div>
            {row.is_cancelled ? (
              <span className={`badge ${TONE.slate}`}>Cancelled</span>
            ) : scope === 'needs_confirmation' ? (
              <span className={`badge ${TONE.amber}`}>
                <ClipboardCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {row.checked_in} checked in · confirm crew &amp; hours
              </span>
            ) : row.attendance_finalized ? (
              <span className={`badge ${TONE.green}`}>Hours posted</span>
            ) : (
              <>
                {row.pending_requests > 0 && (
                  <span className={`badge ${TONE.amber}`}>
                    {row.pending_requests} {row.pending_requests === 1 ? 'request' : 'requests'} waiting
                  </span>
                )}
                <span className={`badge ${fillTone(row)}`}>
                  {row.filled} of {row.total} seats filled
                </span>
              </>
            )}
            <ChevronRight className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
};

export default NightList;
