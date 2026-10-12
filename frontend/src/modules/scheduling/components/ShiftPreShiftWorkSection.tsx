/**
 * The pre-shift work logged against one shift, for its officer to review.
 *
 * Self-loading so the close-out wizard and the shift detail panel can each
 * drop it in without threading another request through their own state.
 * Renders nothing until there is something to show, and nothing at all on a
 * failed lookup — the surrounding screen's job must not depend on it.
 */

import React, { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { schedulingService } from '../services/api';
import type { PreShiftWorkSession } from '../services/api';
import PreShiftWorkReviewList from './PreShiftWorkReviewList';
import { useAuthStore } from '../../../stores/authStore';

interface ShiftPreShiftWorkSectionProps {
  shiftId: string;
  /** Spacing/borders from the host screen, applied only when there is content. */
  className?: string | undefined;
}

const ShiftPreShiftWorkSection: React.FC<ShiftPreShiftWorkSectionProps> = ({ shiftId, className }) => {
  const { user, checkPermission } = useAuthStore();
  const [sessions, setSessions] = useState<PreShiftWorkSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    void schedulingService
      .getShiftPreShiftWork(shiftId)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  if (sessions.length === 0) return null;

  const awaiting = sessions.filter((s) => s.status === 'pending' || s.status === 'active').length;

  return (
    <section aria-labelledby={`pre-shift-work-${shiftId}`} className={`space-y-2 ${className ?? ''}`}>
      <h4
        id={`pre-shift-work-${shiftId}`}
        className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold"
      >
        <Timer className="h-4 w-4" aria-hidden="true" />
        Pre-shift work
        {awaiting > 0 && (
          <span className="badge bg-violet-500/15 text-violet-800 dark:text-violet-200">{awaiting} to review</span>
        )}
      </h4>
      <p className="text-theme-text-muted text-xs">
        Time members logged preparing for this shift before check-in opened. It counts toward their hours once approved.
      </p>
      <PreShiftWorkReviewList
        sessions={sessions}
        currentUserId={user?.id}
        canManage={checkPermission('scheduling.manage')}
        onReviewed={(updated) => setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))}
      />
    </section>
  );
};

export default ShiftPreShiftWorkSection;
