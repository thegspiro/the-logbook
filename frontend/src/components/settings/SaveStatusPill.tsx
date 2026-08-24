/**
 * Autosave status for a settings screen, shown against the page header.
 *
 * The settings screens save on change rather than behind a Save button, so the
 * member needs a standing answer to "did that stick?" in one place. This is
 * that answer. It replaces the per-toggle success toast Events Settings fired,
 * which said the same thing once per switch and buried anything that mattered.
 *
 * Failure is the state worth care: it keeps whatever the member typed (the
 * caller never rolls the field back) and offers the retry, because a silent
 * revert to the stored value looks identical to never having typed at all.
 */

import React from 'react';
import { CheckCircle2, Loader, AlertTriangle } from 'lucide-react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface SaveStatusPillProps {
  state: SaveState;
  onRetry?: (() => void) | undefined;
}

export const SaveStatusPill: React.FC<SaveStatusPillProps> = ({ state, onRetry }) => {
  if (state === 'idle') {
    // Nothing has been written this visit, so there is no outcome to report.
    return null;
  }

  if (state === 'saving') {
    return (
      <span
        className="settings-save-pill bg-theme-surface-hover text-theme-text-secondary"
        role="status"
        aria-live="polite"
      >
        <Loader className="h-4 w-4 animate-spin" aria-hidden="true" />
        Saving…
      </span>
    );
  }

  if (state === 'error') {
    return (
      <span
        className="settings-save-pill bg-theme-alert-danger-bg text-theme-alert-danger-text"
        role="status"
        aria-live="assertive"
      >
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {onRetry ? (
          <button type="button" onClick={onRetry} className="underline underline-offset-2">
            Couldn&apos;t save — retry
          </button>
        ) : (
          <>Couldn&apos;t save</>
        )}
      </span>
    );
  }

  return (
    <span
      className="settings-save-pill bg-theme-accent-green-muted text-theme-accent-green"
      role="status"
      aria-live="polite"
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      All changes saved
    </span>
  );
};

export default SaveStatusPill;
