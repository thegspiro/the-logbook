import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDateCustom } from '../../utils/dateFormatting';

interface DocumentCorrectionNoticeProps {
  /** UTC timestamp at which the source minutes were reopened. */
  since: string;
  className?: string;
}

/**
 * MM-17 owner decision (2026-10-12): a published set of minutes stays
 * readable while the minutes are reopened for correction, but must say so —
 * members otherwise take superseded text for the approved record. The backend
 * sets `under_correction_since` on reopen and clears it when the corrected
 * minutes are republished over this document.
 */
export const DocumentCorrectionNotice: React.FC<DocumentCorrectionNoticeProps> = ({ since, className = '' }) => {
  const tz = useTimezone();
  return (
    <div className={`alert-warning flex items-start gap-2 p-3 text-xs ${className}`} role="status">
      <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="text-theme-text-primary">
        <span className="font-semibold">Being corrected.</span> These minutes were reopened for correction on{' '}
        {formatDateCustom(since, { month: 'short', day: 'numeric', year: 'numeric' }, tz)}. A corrected version will
        replace this document when it is approved.
      </p>
    </div>
  );
};
