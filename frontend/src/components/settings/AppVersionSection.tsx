/**
 * App Version & Refresh section (user settings → App).
 *
 * The self-service half of update handling. Detection is automatic
 * (useAppUpdate), but a device that has already gone stale — an installed PWA
 * pinned to an old shell, a wedged precache — has no automatic way out and no
 * "hard reload" gesture: a home-screen PWA has no address bar and no
 * Ctrl+Shift+R. This section is that gesture, plus the build ID a member can
 * read out over the phone when someone asks which version they are on.
 */

import React, { useState } from 'react';
import { RefreshCw, Trash2, CheckCircle, WifiOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { fetchServerBuildId, formatBuildId, getCurrentBuildId, getCurrentBuildTime } from '../../utils/appVersion';
import { formatDateCustom } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { applyAppUpdate } from '../../utils/updateRecovery';
import { forceAppRefresh } from '../../utils/forceAppRefresh';

export const AppVersionSection: React.FC = () => {
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [upToDate, setUpToDate] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  const currentBuildId = getCurrentBuildId();
  // A random hex id says nothing about age. The release date is what turns
  // "I'm on 3f9a2c14e8b7" into an answer support can act on — a member three
  // deployments behind reads out a date, not an id nobody can rank.
  const currentBuildTime = getCurrentBuildTime();
  const busy = checking || refreshing;

  const handleCheck = async (): Promise<void> => {
    setChecking(true);
    setUpToDate(false);
    try {
      const serverBuildId = await fetchServerBuildId();

      if (serverBuildId === null) {
        toast.error("Couldn't reach the server to check for updates.");
        return;
      }

      if (serverBuildId === currentBuildId) {
        setUpToDate(true);
        toast.success("You're on the latest version.");
        return;
      }

      // Swaps the service worker before reloading. A bare reload on an
      // installed PWA is served by the OLD worker's precached index.html and
      // looks like it did nothing. applyAppUpdate additionally clears the
      // caches when a previous attempt at this same build already failed.
      const remedy = await applyAppUpdate(serverBuildId);

      if (remedy === 'exhausted') {
        // Two reloads have already failed to move this device onto that build,
        // so promising a third would be a lie. Force refresh, immediately
        // below, is the remedy that has not been tried.
        toast.error('A new version is available, but this device could not install it. Try Force refresh below.');
        return;
      }

      toast.success('A new version is available — updating now.');
    } finally {
      setChecking(false);
    }
  };

  const handleForceRefresh = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Force refresh this device?',
      message:
        'This clears every stored copy of the app on this device and reloads it from the server, ' +
        'so it needs a working connection. You stay signed in, and anything saved offline but not ' +
        'yet synced is kept. The next few screens may load a little slower while the app re-downloads.',
      confirmLabel: 'Force refresh',
      cancelLabel: 'Keep browsing',
      variant: 'warning',
    });
    if (!confirmed) return;

    setRefreshing(true);
    setUnreachable(false);

    const outcome = await forceAppRefresh();

    // 'reloading' ends in a page reload, so there is nothing to clean up and no
    // success message worth showing. 'unreachable' means nothing was touched.
    if (outcome === 'unreachable') {
      setUnreachable(true);
      setRefreshing(false);
      toast.error('Cannot reach the server — nothing was cleared.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-theme-text-primary mb-4 text-xl font-semibold">App Version</h2>
        <p className="text-theme-text-secondary mb-6 text-sm">
          Check which version of The Logbook this device is running, and force it back in sync with the server.
        </p>
      </div>

      <div className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 border-b py-4">
        <div className="pr-4">
          <span className="text-theme-text-primary text-sm font-medium">Installed version</span>
          <p className="text-theme-text-secondary text-sm">
            Quote this if you report a problem — it tells support exactly which build you are seeing, and when it was
            released.
          </p>
        </div>
        <div className="text-right">
          <code className="bg-theme-input-bg text-theme-text-primary rounded-sm px-2 py-1 font-mono text-sm">
            {formatBuildId(currentBuildId)}
          </code>
          {currentBuildTime && (
            <p className="text-theme-text-secondary mt-1 text-sm">
              Released{' '}
              {formatDateCustom(
                currentBuildTime,
                { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
                tz
              )}
            </p>
          )}
        </div>
      </div>

      <div className="border-theme-surface-border flex flex-wrap items-center justify-between gap-3 border-b py-4">
        <div className="pr-4">
          <span className="text-theme-text-primary text-sm font-medium">Check for updates</span>
          <p className="text-theme-text-secondary text-sm">
            Asks the server whether a newer version has been released. If one has, the app reloads onto it.
          </p>
          {upToDate && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              You are running the latest version.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleCheck();
          }}
          className="btn-primary flex items-center gap-2 text-sm font-medium"
        >
          <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="pr-4">
          <span className="text-theme-text-primary text-sm font-medium">Force refresh this device</span>
          <p className="text-theme-text-secondary text-sm">
            Use this if the app still looks out of date after an update, or shows an old department name or logo. It
            clears every stored copy of the app and reloads from the server. You stay signed in, and offline work that
            has not synced yet is kept.
          </p>
          <p className="text-theme-text-muted mt-1 text-sm">
            Needs a working connection: this discards the offline copy of the app and has to download a replacement.
          </p>
          {unreachable && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400" role="alert">
              <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              The server could not be reached, so nothing was cleared. Reconnect and try again — refreshing now would
              have left this device with no working copy of the app.
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void handleForceRefresh();
          }}
          className="btn-secondary flex items-center gap-2 text-sm font-medium"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {refreshing ? 'Refreshing…' : 'Force refresh'}
        </button>
      </div>
    </div>
  );
};
