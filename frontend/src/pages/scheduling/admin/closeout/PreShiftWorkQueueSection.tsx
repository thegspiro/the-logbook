/**
 * Pre-shift time awaiting review, department-wide.
 *
 * A shift can be finalized with pre-shift work still undecided, so the close-out
 * queue alone would lose track of it: the shift leaves that queue the moment it
 * is finalized. This list is the server's answer — pending sessions plus any
 * still running after their shift began (the member forgot to scan out) — and
 * renders nothing when there is nothing to decide.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { schedulingService } from '../../../../modules/scheduling/services/api';
import type { PreShiftWorkSession } from '../../../../modules/scheduling/services/api';
import PreShiftWorkReviewList from '../../../../modules/scheduling/components/PreShiftWorkReviewList';
import { useAuthStore } from '../../../../stores/authStore';

const PreShiftWorkQueueSection: React.FC = () => {
  const { user, checkPermission } = useAuthStore();
  const [sessions, setSessions] = useState<PreShiftWorkSession[]>([]);

  const load = useCallback(async () => {
    try {
      setSessions(await schedulingService.getPreShiftWorkAwaitingReview());
    } catch {
      // Supplementary to the close-out queue above it; a failed read leaves
      // that screen usable rather than replacing it with an error.
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (sessions.length === 0) return null;

  return (
    <section aria-labelledby="pre-shift-work-queue" className="card space-y-3 p-4">
      <h2 id="pre-shift-work-queue" className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
        <Timer className="h-5 w-5" aria-hidden="true" />
        Pre-shift time awaiting review
      </h2>
      <p className="text-theme-text-muted text-sm">
        Prep work members timed before their shift&apos;s check-in opened. It counts toward their hours once approved.
      </p>
      <PreShiftWorkReviewList
        sessions={sessions}
        currentUserId={user?.id}
        canManage={checkPermission('scheduling.manage')}
        showShift
        onReviewed={(updated) =>
          // A decided session leaves the queue; the list is what is still owed.
          setSessions((prev) => prev.filter((s) => s.id !== updated.id))
        }
      />
    </section>
  );
};

export default PreShiftWorkQueueSection;
