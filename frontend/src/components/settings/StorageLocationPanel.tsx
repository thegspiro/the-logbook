import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Database, HardDrive, Loader2 } from 'lucide-react';
import { Skeleton } from '../ux/Skeleton';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTimezone } from '../../hooks/useTimezone';
import { organizationService } from '../../services/userServices';
import type { FileStorageStatus } from '../../types/user';
import { formatDateTime } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

interface StorageLocationPanelProps {
  /** The section's save is in flight; the status is re-read once it lands. */
  savingStorage: boolean;
}

/**
 * Where new files actually go, as the server decided it. Saving a remote
 * platform's settings is not enough on its own: a connection test has to pass
 * with exactly what is saved before uploads move there, so this panel reports
 * the server's answer rather than the platform picked in the form. Every name
 * it shows for the platform comes from the server, so a new platform needs no
 * change here.
 */
const StorageLocationPanel: React.FC<StorageLocationPanelProps> = ({ savingStorage }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [status, setStatus] = useState<FileStorageStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'test' | 'local' | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await organizationService.getFileStorageStatus());
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not check where files are stored.'));
    }
  }, []);

  useEffect(() => {
    if (!savingStorage) void load();
  }, [savingStorage, load]);

  const short = status?.platform_short_label ?? 'remote storage';
  const noun = status?.container_noun ?? 'store';

  const handleTest = async () => {
    setBusy('test');
    setTestError(null);
    try {
      const next = await organizationService.activateRemoteStorage();
      setStatus(next);
      toast.success(`Connection test passed. New files now go to your ${short} ${noun}.`);
    } catch (err: unknown) {
      setTestError(getErrorMessage(err, 'The connection test failed. Nothing was changed.'));
    } finally {
      setBusy(null);
    }
  };

  const handleUseLocal = async () => {
    const ok = await confirm({
      title: 'Store new files on this server?',
      message: `Uploads from now on are saved on this server’s disk. Files already in your ${short} ${noun} stay there and keep working.`,
      confirmLabel: 'Store on this server',
      cancelLabel: `Keep using ${short}`,
      variant: 'warning',
    });
    if (!ok) return;
    setBusy('local');
    try {
      setStatus(await organizationService.deactivateRemoteStorage());
      toast.success('New files are stored on this server again');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change where files are stored.'));
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div className="alert-danger text-theme-text-primary text-sm" role="alert">
        {loadError}
      </div>
    );
  }
  if (!status) {
    return <Skeleton className="h-20 w-full" />;
  }

  const onRemote = status.new_files_go_to !== 'local';
  const unconnected = !status.platform_connectable && status.platform !== 'local';
  const connectable = status.platform_connectable;

  return (
    <section
      aria-label="Where new files are stored"
      className="border-theme-surface-border bg-theme-surface-secondary space-y-3 rounded-lg border p-4"
    >
      <div className="flex items-start gap-3">
        {onRemote ? (
          <Database className="text-theme-accent-blue mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        ) : (
          <HardDrive className="text-theme-text-secondary mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 space-y-1">
          <p className="text-theme-text-primary text-sm font-medium">
            {onRemote ? (
              <>
                New files go to your {short} {noun} <code className="break-all">{status.container}</code>
              </>
            ) : (
              'New files are stored on this server’s disk'
            )}
          </p>
          {onRemote && status.activated_at && (
            <p className="text-theme-text-muted text-xs">
              Connection tested {formatDateTime(status.activated_at, tz)}
              {status.endpoint_url ? ` via ${status.endpoint_url}` : ''}
            </p>
          )}
          <p className="text-theme-text-muted text-xs">
            Files already stored stay where they are and keep working when this changes.
          </p>
        </div>
      </div>

      {unconnected && (
        <p className="text-theme-text-secondary text-sm">
          This platform is not connected yet, so files stay on this server.
          {status.available_platforms.length > 0 && ` Available now: ${status.available_platforms.join(', ')}.`}
        </p>
      )}

      {connectable && status.changed_since_test && (
        <div className="alert-warning text-theme-text-primary flex items-start gap-2 text-sm" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The {short} settings changed after the last successful test, so new files are going to this server’s disk.
            Test the connection again to send them to the {noun}.
          </span>
        </div>
      )}

      {connectable && status.problem && (
        <div className="alert-danger text-theme-text-primary text-sm" role="alert">
          {status.problem}
        </div>
      )}

      {testError && (
        <div className="alert-danger text-theme-text-primary text-sm" role="alert">
          {testError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {connectable && !onRemote && (
          <>
            <button
              type="button"
              onClick={() => {
                void handleTest();
              }}
              disabled={busy !== null || savingStorage}
              className="btn-info inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'test' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {busy === 'test' ? 'Testing…' : `Test and switch to ${short}`}
            </button>
            <p className="text-theme-text-muted text-xs">
              Save the settings first. The test writes, reads back and deletes a small file in the {noun}.
            </p>
          </>
        )}
        {onRemote && (
          <button
            type="button"
            onClick={() => {
              void handleUseLocal();
            }}
            disabled={busy !== null}
            className="btn-secondary inline-flex items-center gap-2 rounded-md text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'local' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Store new files on this server instead
          </button>
        )}
      </div>
    </section>
  );
};

export default StorageLocationPanel;
