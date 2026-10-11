/**
 * Officer review of pre-shift work sessions.
 *
 * Used in three places — the close-out wizard, the shift detail panel and the
 * department-wide review queue — so a session reads and is decided the same
 * way wherever an officer meets it. The list renders what it is given; the
 * caller fetches, and replaces a row with what `onReviewed` hands back.
 */

import React, { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../services/api';
import type { PreShiftWorkSession, PreShiftWorkReview } from '../services/api';
import { formatDuration } from '../../admin-hours/utils/formatDuration';
import { useTimezone } from '../../../hooks/useTimezone';
import {
  formatCalendarDate,
  formatDateTime,
  formatForDateTimeInput,
  formatTime,
  localToUTC,
} from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

interface PreShiftWorkReviewListProps {
  sessions: PreShiftWorkSession[];
  currentUserId: string | undefined;
  /** Holds scheduling.manage — may approve anyone's time, their own included. */
  canManage: boolean;
  /** Show which shift each session belongs to (the department-wide queue). */
  showShift?: boolean;
  onReviewed: (session: PreShiftWorkSession) => void;
}

const STATUS_LABEL: Record<PreShiftWorkSession['status'], string> = {
  active: 'Still running',
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_CLASS: Record<PreShiftWorkSession['status'], string> = {
  active: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  pending: 'bg-violet-500/15 text-violet-800 dark:text-violet-200',
  approved: 'bg-green-500/15 text-green-800 dark:text-green-200',
  rejected: 'bg-red-500/15 text-red-800 dark:text-red-200',
};

interface RowProps {
  session: PreShiftWorkSession;
  canDecide: boolean;
  blockedReason: string | null;
  showShift: boolean;
  onReviewed: (session: PreShiftWorkSession) => void;
}

const ReviewRow: React.FC<RowProps> = ({ session, canDecide, blockedReason, showShift, onReviewed }) => {
  const tz = useTimezone();
  const needsEnd = !session.ended_at;
  const [minutes, setMinutes] = useState(session.duration_minutes != null ? String(session.duration_minutes) : '');
  const [endedAt, setEndedAt] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const open = session.status === 'pending' || session.status === 'active';

  const decide = async (decision: PreShiftWorkReview['decision']) => {
    if (needsEnd && !endedAt) {
      toast.error('Enter when this pre-shift work ended.');
      return;
    }
    const parsed = Number.parseInt(minutes, 10);
    const review: PreShiftWorkReview = {
      decision,
      approved_minutes: decision === 'approve' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
      ended_at: needsEnd ? localToUTC(endedAt, tz) || undefined : undefined,
    };
    setBusy(decision);
    try {
      const updated = await schedulingService.reviewPreShiftWork(session.id, review);
      toast.success(decision === 'approve' ? 'Pre-shift time approved' : 'Pre-shift time rejected');
      onReviewed(updated);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the review'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="border-theme-surface-border space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-theme-text-primary text-sm font-medium">{session.user_name || 'Member'}</p>
          {showShift && (
            <p className="text-theme-text-muted text-xs">
              For {session.shift_apparatus_name || 'shift'}
              {session.shift_date
                ? ` · ${formatCalendarDate(session.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}`
                : ''}
              {session.shift_start_time ? ` ${formatTime(session.shift_start_time, tz)}` : ''}
            </p>
          )}
          <p className="text-theme-text-muted text-xs">
            {formatDateTime(session.started_at, tz)}
            {session.ended_at ? ` → ${formatTime(session.ended_at, tz)}` : ' → not ended'}
            {session.duration_minutes != null ? ` · ${formatDuration(session.duration_minutes)}` : ''}
          </p>
        </div>
        <span className={`badge ${STATUS_CLASS[session.status]}`}>{STATUS_LABEL[session.status]}</span>
      </div>
      {session.note && <p className="text-theme-text-secondary text-sm">“{session.note}”</p>}
      {session.status === 'approved' && session.approved_minutes != null && (
        <p className="text-theme-text-muted text-xs">
          {formatDuration(session.approved_minutes)} credited
          {session.reviewed_by_name ? ` by ${session.reviewed_by_name}` : ''}
        </p>
      )}
      {session.status === 'rejected' && session.reviewed_by_name && (
        <p className="text-theme-text-muted text-xs">Rejected by {session.reviewed_by_name}</p>
      )}

      {open && blockedReason && <p className="text-xs text-amber-700 dark:text-amber-300">{blockedReason}</p>}

      {open && canDecide && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {needsEnd && (
              <div className="min-w-[12rem] flex-1">
                <label htmlFor={`pre-work-end-${session.id}`} className="form-label-sm">
                  Ended at
                </label>
                <input
                  id={`pre-work-end-${session.id}`}
                  type="datetime-local"
                  value={endedAt}
                  min={formatForDateTimeInput(session.started_at, tz)}
                  onChange={(e) => setEndedAt(e.target.value)}
                  className="form-input-sm"
                />
              </div>
            )}
            <div className="w-32">
              <label htmlFor={`pre-work-minutes-${session.id}`} className="form-label-sm">
                Minutes to credit
              </label>
              <input
                id={`pre-work-minutes-${session.id}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder={needsEnd ? 'From end time' : undefined}
                className="form-input-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void decide('reject')}
              disabled={busy !== null}
              className="btn-secondary btn-sm flex items-center gap-1"
            >
              {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Reject
            </button>
            <button
              type="button"
              onClick={() => void decide('approve')}
              disabled={busy !== null}
              className="btn-success btn-sm flex items-center gap-1"
            >
              {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Approve
            </button>
          </div>
        </div>
      )}
    </li>
  );
};

const PreShiftWorkReviewList: React.FC<PreShiftWorkReviewListProps> = ({
  sessions,
  currentUserId,
  canManage,
  showShift = false,
  onReviewed,
}) => {
  if (sessions.length === 0) return null;
  return (
    <ul className="space-y-2">
      {sessions.map((s) => {
        // Mirrors the server's rule so the officer is told why rather than
        // offered buttons it would refuse: a shift officer may not approve
        // their own pre-shift time.
        const ownTime = Boolean(currentUserId) && s.user_id === currentUserId;
        const blockedReason =
          ownTime && !canManage ? 'This is your own time — someone with scheduling management must approve it.' : null;
        return (
          <ReviewRow
            key={s.id}
            session={s}
            canDecide={!blockedReason}
            blockedReason={blockedReason}
            showShift={showShift}
            onReviewed={onReviewed}
          />
        );
      })}
    </ul>
  );
};

export default PreShiftWorkReviewList;
