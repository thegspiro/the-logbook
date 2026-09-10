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
  /** True while a read is in flight, including one this button started. */
  loading: boolean;
  onRefresh: () => void;
}

const TierRefreshAlert: React.FC<TierRefreshAlertProps> = ({ unconfirmedSave, dirty, loading, onRefresh }) => {
  // The editor stays live under this warning, so the ladder can have moved on
  // from what was stored. Saying "the ladder below is what was stored" then
  // describes a screen that also holds unsaved edits — and if the next save is
  // refused, that claim stays on screen over a draft nothing has accepted.
  const heading = unconfirmedSave
    ? dirty
      ? 'Your last save was stored, but this page could not be refreshed afterwards.'
      : 'Your tiers were saved, but this page could not be refreshed afterwards.'
    : 'This page could not be refreshed.';

  const detail = unconfirmedSave
    ? dirty
      ? 'The ladder below has changes you have not saved yet. Member counts, and any adjustment the server made when it saved, are not shown.'
      : 'The ladder below is what was stored. Member counts, and any adjustment the server made when it saved, are not shown yet.'
    : dirty
      ? 'The ladder below has changes you have not saved yet, over the one last read from the server. Member counts may be out of date.'
      : 'The ladder below is the one last read from the server. Member counts may be out of date.';

  return (
    <div className="alert-warning mb-4" role="status">
      <p className="text-theme-text-primary text-sm font-medium">{heading}</p>
      <p className="text-theme-text-muted mt-1 text-sm">{detail}</p>
      {/* Refresh replaces the whole configuration with the server's, so offering
          it beside unsaved edits would discard them without asking — the hazard
          Reset exists to make deliberate. It is also withheld while a read is
          already running: this alert stays mounted for the whole of one, so a
          second click would start a second GET through the same attempt effect,
          and a late failure landing after a newer success would report a
          confirmed read as failed. */}
      <button
        type="button"
        className="btn-secondary mobile-touch-target mt-3 px-4 text-sm font-medium"
        onClick={onRefresh}
        disabled={dirty || loading}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>
      {dirty && (
        <p className="text-theme-text-muted mt-2 text-sm">Save your changes first — refreshing would discard them.</p>
      )}
    </div>
  );
};

export default TierRefreshAlert;
