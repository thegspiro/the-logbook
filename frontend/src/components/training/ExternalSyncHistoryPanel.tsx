/**
 * Sync history for the external training providers: each run a provider made,
 * and the classes that run brought in.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, RefreshCw } from 'lucide-react';
import { EmptyState } from '../ux';
import { externalTrainingService } from '../../services/api';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate, formatDateTime } from '../../utils/dateFormatting';
import { formatHoursExact } from '../../utils/hoursFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import type {
  ExternalTrainingImport,
  ExternalTrainingProvider,
  ExternalTrainingSyncLog,
  ImportStatus,
  SyncStatus,
} from '../../types/training';

// The sync-logs endpoint caps at 100; a screenful of recent runs is what an
// officer checking "did last night's pull work" needs.
const RUN_FETCH_LIMIT = 25;
// The imports endpoint's own ceiling.
const CLASS_FETCH_LIMIT = 200;

const SYNC_TYPE_LABEL: Record<ExternalTrainingSyncLog['sync_type'], string> = {
  full: 'Full sync',
  incremental: 'Scheduled pull',
  manual: 'Manual sync',
  review: 'Daily review',
  upload: 'Uploaded report',
};

const SYNC_STATUS_LABEL: Record<SyncStatus, string> = {
  pending: 'Pending',
  in_progress: 'Running',
  completed: 'Completed',
  partial: 'Completed with errors',
  failed: 'Failed',
};

const IMPORT_STATUS_LABEL: Record<ImportStatus, string> = {
  imported: 'Added to records',
  pending: 'Waiting for review',
  failed: 'Failed',
  skipped: 'Skipped',
  duplicate: 'Already on file',
};

const classHours = (item: ExternalTrainingImport): string => {
  if (item.credit_hours != null) return formatHoursExact(item.credit_hours);
  if (item.duration_minutes != null) return formatHoursExact(item.duration_minutes / 60);
  return '—';
};

interface RunClasses {
  loading: boolean;
  error: string | null;
  items: ExternalTrainingImport[];
}

interface SyncRunProps {
  run: ExternalTrainingSyncLog;
  memberNames: Record<string, string>;
}

const SyncRun: React.FC<SyncRunProps> = ({ run, memberNames }) => {
  const tz = useTimezone();
  const [expanded, setExpanded] = useState(false);
  const [classes, setClasses] = useState<RunClasses | null>(null);
  const touched = run.records_imported + run.records_updated;
  const panelId = `sync-run-classes-${run.id}`;

  const loadClasses = useCallback(async () => {
    setClasses({ loading: true, error: null, items: [] });
    try {
      const items = await externalTrainingService.getImportedRecords(run.provider_id, {
        sync_log_id: run.id,
        limit: CLASS_FETCH_LIMIT,
      });
      setClasses({ loading: false, error: null, items });
    } catch (err: unknown) {
      setClasses({
        loading: false,
        error: getErrorMessage(err, 'Could not load the classes for this run.'),
        items: [],
      });
    }
  }, [run.id, run.provider_id]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && (classes === null || classes.error)) void loadClasses();
  };

  const memberFor = (item: ExternalTrainingImport): string =>
    (item.external_user_id && memberNames[item.external_user_id]) || item.external_user_id || 'Unknown member';

  return (
    <li className="card p-4">
      <div className="split-row gap-3 sm:items-start">
        <div className="split-row-main">
          <p className="text-theme-text-primary text-sm font-semibold">{formatDateTime(run.started_at, tz)}</p>
          <p className="text-theme-text-secondary text-sm">
            {SYNC_TYPE_LABEL[run.sync_type] ?? run.sync_type} · {SYNC_STATUS_LABEL[run.status] ?? run.status}
          </p>
          <p className="text-theme-text-muted mt-1 text-xs">
            {run.records_fetched} fetched · {run.records_imported} new · {run.records_updated} updated ·{' '}
            {run.records_skipped} skipped · {run.records_failed} failed
          </p>
          {run.error_message && (
            <p className="alert-warning mt-2 text-sm break-words" role="note">
              {run.error_message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          className="split-row-aside btn-secondary btn-md inline-flex shrink-0 items-center gap-1.5 self-start text-sm"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          )}
          {expanded ? 'Hide classes' : 'Show classes'}
        </button>
      </div>

      {expanded && (
        <div id={panelId} className="mt-4">
          {classes === null || classes.loading ? (
            <p className="text-theme-text-muted text-sm" role="status">
              Loading classes...
            </p>
          ) : classes.error ? (
            <p className="alert-danger text-sm" role="alert">
              {classes.error}
            </p>
          ) : classes.items.length === 0 ? (
            <p className="text-theme-text-muted text-sm">
              {touched > 0
                ? 'Every class from this run was synced again by a later run and is listed there.'
                : 'This run brought in no classes.'}
            </p>
          ) : (
            <>
              {classes.items.length < touched && (
                <p className="text-theme-text-muted mb-3 text-xs">
                  Showing {classes.items.length} of {touched}. Classes synced again by a later run are listed under that
                  run.
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="rwd-table w-full">
                  <thead className="bg-theme-surface-secondary text-theme-text-muted text-left text-xs font-medium uppercase">
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        Class
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Member
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Completed
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Hours
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Outcome
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-theme-surface-border divide-y">
                    {classes.items.map((item) => (
                      <tr key={item.id}>
                        <td data-label="Class" className="text-theme-text-primary px-3 py-2 text-sm">
                          {item.course_title}
                          {item.course_code && <span className="text-theme-text-muted"> ({item.course_code})</span>}
                        </td>
                        <td data-label="Member" className="text-theme-text-secondary px-3 py-2 text-sm break-words">
                          {memberFor(item)}
                        </td>
                        <td data-label="Completed" className="text-theme-text-secondary px-3 py-2 text-sm">
                          {item.completion_date ? formatDate(item.completion_date, tz) : '—'}
                        </td>
                        <td data-label="Hours" className="text-theme-text-secondary px-3 py-2 text-sm">
                          {classHours(item)}
                        </td>
                        <td data-label="Outcome" className="text-theme-text-primary px-3 py-2 text-sm">
                          {IMPORT_STATUS_LABEL[item.import_status] ?? item.import_status}
                          {item.import_error && (
                            <span className="text-theme-text-muted block text-xs break-words">{item.import_error}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
};

interface ExternalSyncHistoryPanelProps {
  providers: ExternalTrainingProvider[];
}

const ExternalSyncHistoryPanel: React.FC<ExternalSyncHistoryPanelProps> = ({ providers }) => {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? '');
  const [runs, setRuns] = useState<ExternalTrainingSyncLog[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!providers.some((provider) => provider.id === providerId)) setProviderId(providers[0]?.id ?? '');
  }, [providers, providerId]);

  useEffect(() => {
    if (!providerId) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      // The provider's own member matches name each class's member without
      // pulling the whole roster; a member not matched yet shows the id the
      // provider sent.
      const [logs, mappings] = await Promise.allSettled([
        externalTrainingService.getSyncLogs(providerId, RUN_FETCH_LIMIT),
        externalTrainingService.getUserMappings(providerId),
      ]);
      if (cancelled) return;
      if (logs.status === 'fulfilled') {
        setRuns(logs.value);
      } else {
        setRuns([]);
        setError(getErrorMessage(logs.reason, 'Could not load the sync history.'));
      }
      setMemberNames(
        mappings.status === 'fulfilled'
          ? Object.fromEntries(
              mappings.value.flatMap((mapping) => {
                const name = mapping.internal_user_name || mapping.external_name || mapping.external_email;
                return name ? [[mapping.external_user_id, name]] : [];
              })
            )
          : {}
      );
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [providerId, reloadKey]);

  if (providers.length === 0) {
    return (
      <div className="card" role="tabpanel">
        <EmptyState
          icon={History}
          title="No sync history yet"
          description="Connect a training provider and its syncs will be listed here."
        />
      </div>
    );
  }

  const providerName = providers.find((provider) => provider.id === providerId)?.name ?? '';

  return (
    <div className="space-y-4" role="tabpanel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {providers.length > 1 ? (
          <div>
            <label htmlFor="sync-history-provider" className="form-label">
              Provider
            </label>
            <select
              id="sync-history-provider"
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className="form-input sm:w-72"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <h2 className="text-theme-text-primary text-lg font-semibold">{providerName}</h2>
        )}
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="btn-secondary btn-md inline-flex items-center gap-1.5 self-start text-sm sm:self-auto"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" aria-hidden="true" />
          <span className="sr-only">Loading sync history...</span>
        </div>
      ) : error ? (
        <p className="alert-danger text-sm" role="alert">
          {error}
        </p>
      ) : runs.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={History}
            title="No syncs recorded"
            description={`Each sync or uploaded report from ${providerName} will appear here with the classes it brought in.`}
          />
        </div>
      ) : (
        <ul className="space-y-3" aria-label={`Sync history for ${providerName}`}>
          {runs.map((run) => (
            <SyncRun key={run.id} run={run} memberNames={memberNames} />
          ))}
        </ul>
      )}
    </div>
  );
};

export default ExternalSyncHistoryPanel;
