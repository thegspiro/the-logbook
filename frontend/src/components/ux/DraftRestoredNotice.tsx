import React from 'react';
import { History } from 'lucide-react';

interface DraftRestoredNoticeProps {
  /** Throw the restored draft away and return the form to blank. */
  onDiscard: () => void;
}

/**
 * Says that a form refilled itself from a local draft (useSessionDraft), and
 * offers to throw that draft away. A form that silently comes back filled in
 * reads as somebody else's work, so the notice is not optional.
 */
export const DraftRestoredNotice: React.FC<DraftRestoredNoticeProps> = ({ onDiscard }) => (
  <div className="alert-info flex flex-wrap items-center justify-between gap-3" role="status">
    <p className="text-theme-alert-info-text flex items-center gap-2 text-sm">
      <History className="text-theme-alert-info-icon h-4 w-4 shrink-0" aria-hidden="true" />
      Restored your unsaved draft.
    </p>
    <button type="button" onClick={onDiscard} className="btn-secondary touch:min-h-11 text-sm">
      Discard draft
    </button>
  </div>
);

export default DraftRestoredNotice;
