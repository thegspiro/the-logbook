import React from 'react';

/**
 * The ladder on screen could not be re-read from the server.
 *
 * Distinct from the load-failure panel each consumer renders in its place, and
 * the distinction is the whole point: that panel means there is nothing
 * trustworthy to show, so it replaces the editor and says nothing has changed.
 * This one means the ladder below is real and the screen around it may be
 * stale — most often because a save was accepted and its read-back was not.
 * Discarding that difference is what let a stored ladder be reported as
 * missing, and what let a failed request be reported as nothing at all.
 *
 * Shared rather than written twice: setup and Members → Settings both drive
 * `useTierEditor`, and the first cut of this warning reached only setup, so the
 * settings screen went on showing stale member counts with a success toast as
 * the only account of the failure.
 */
interface TierRefreshAlertProps {
  /** True when a PUT was accepted and no read has confirmed it since. */
  unconfirmedSave: boolean;
  /** True when the editor holds edits a refresh would overwrite. */
  dirty: boolean;
  onRefresh: () => void;
}

const TierRefreshAlert: React.FC<TierRefreshAlertProps> = ({ unconfirmedSave, dirty, onRefresh }) => (
  <div className="alert-warning mb-4" role="status">
    <p className="text-theme-text-primary text-sm font-medium">
      {unconfirmedSave
        ? 'Your tiers were saved, but this page could not be refreshed afterwards.'
        : 'This page could not be refreshed.'}
    </p>
    <p className="text-theme-text-muted mt-1 text-sm">
      {unconfirmedSave
        ? 'The ladder below is what was stored. Member counts, and any adjustment the server made when it saved, are not shown yet.'
        : 'The ladder below is the one last read from the server. Member counts may be out of date.'}
    </p>
    {/* Refresh replaces the whole configuration with the server's, so offering
        it beside unsaved edits would discard them without asking — the hazard
        Reset exists to make deliberate. Save first, then refresh. */}
    <button
      type="button"
      className="btn-secondary mobile-touch-target mt-3 px-4 text-sm font-medium"
      onClick={onRefresh}
      disabled={dirty}
    >
      Refresh
    </button>
    {dirty && (
      <p className="text-theme-text-muted mt-2 text-sm">Save your changes first — refreshing would discard them.</p>
    )}
  </div>
);

export default TierRefreshAlert;
