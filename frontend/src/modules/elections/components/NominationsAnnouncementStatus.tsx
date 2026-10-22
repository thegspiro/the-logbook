/**
 * Nominations Announcement Status
 *
 * Opening nominations queues an email to every member as a background job.
 * This says how it went — still sending, everyone told, or how many were
 * missed — so the officer who opened nominations knows whether to tell the
 * rest another way. The backend's own message is shown rather than one
 * worked out here.
 */

import React, { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { electionService } from '../../../services/api';
import type { BallotSendJob } from '../../../types/election';
import { BallotSendJobStatus } from '../../../constants/enums';

interface NominationsAnnouncementStatusProps {
  electionId: string;
  announcement: BallotSendJob;
  /** Called once a queued or running announcement finishes, to reload the election. */
  onFinished: () => void;
}

const isInProgress = (job: BallotSendJob): boolean =>
  job.status === BallotSendJobStatus.QUEUED || job.status === BallotSendJobStatus.RUNNING;

export const NominationsAnnouncementStatus: React.FC<NominationsAnnouncementStatusProps> = ({
  electionId,
  announcement,
  onFinished,
}) => {
  const inProgress = isInProgress(announcement);
  // Held in a ref so a parent that passes a new callback on every render does
  // not restart the polling each time.
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    if (!inProgress) return undefined;
    let cancelled = false;
    // A failed send or a lost connection both end in a reload: the election
    // response then carries the job's latest state, and a job still running
    // arrives as a new object, which starts this polling again.
    void electionService
      .waitForBallotSendJob(electionId, announcement.id, () => cancelled)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) onFinishedRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [electionId, announcement, inProgress]);

  if (inProgress) {
    return (
      <div className="alert-info flex items-start gap-2" role="status">
        <Loader2 className="text-theme-alert-info-text mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        <p className="text-theme-alert-info-text text-sm">Emailing members that nominations are open…</p>
      </div>
    );
  }

  if (announcement.status === BallotSendJobStatus.FAILED) {
    return (
      <div className="alert-warning flex items-start gap-2" role="alert">
        <AlertCircle className="text-theme-alert-warning-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="text-theme-alert-warning-text text-sm">
          <p className="font-medium">The nominations announcement did not go out.</p>
          {announcement.error && <p>{announcement.error}</p>}
          <p>The election managers have been emailed.</p>
        </div>
      </div>
    );
  }

  const result = announcement.result;
  if (!result) return null;

  if (!result.success) {
    return (
      <div className="alert-warning flex items-start gap-2" role="alert">
        <AlertCircle className="text-theme-alert-warning-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="text-theme-alert-warning-text text-sm">
          <p className="font-medium">{result.message}</p>
          <p>The election managers have been emailed. Let the members who were missed know another way.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="alert-success flex items-start gap-2" role="status">
      <CheckCircle2 className="text-theme-alert-success-text mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-theme-alert-success-text text-sm">{result.message}</p>
    </div>
  );
};

export default NominationsAnnouncementStatus;
