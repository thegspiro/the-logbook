/**
 * Reviewing one roster import, row by row, then importing it.
 *
 * What blocks the import is decided by the server (`blockers`) and shown as
 * it says; this screen does not re-derive readiness (CLAUDE.md pitfall #29).
 * After the import, the page shows what was written and offers to take back
 * the records nobody has touched since.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { FileUp, Sparkles, Trash2, Undo2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumbs } from '../../../components/ux/Breadcrumbs';
import { Pagination } from '../../../components/ux/Pagination';
import { SkeletonPage } from '../../../components/ux/Skeleton';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { ImportRowCard } from '../components/ImportRowCard';
import { ImportTitlesPanel } from '../components/ImportTitlesPanel';
import { historyService } from '../services/api';
import type { HistoryTitle, ImportDetail, ImportRowUpdate, ImportTitleChoice, RemoveRecordsResult } from '../types';

const PAGE_SIZE = 50;

type RowFilter = 'all' | 'undecided' | 'problems';

const COUNT_LABELS: [string, string][] = [
  ['created', 'new records'],
  ['mapped', 'new records linked to member accounts'],
  ['matched', 'existing records added to'],
  ['repeats', 'repeated lines added as extra service'],
  ['skipped', 'rows skipped'],
  ['removed', 'records removed afterwards'],
];

export const HistoryImportReviewPage: React.FC = () => {
  const { importId = '' } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [titles, setTitles] = useState<HistoryTitle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [page, setPage] = useState(1);
  const [removal, setRemoval] = useState<RemoveRecordsResult | null>(null);

  const load = useCallback(() => {
    historyService
      .getImport(importId)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Unable to load this import.')));
  }, [importId]);

  useEffect(() => {
    load();
    void historyService
      .listTitles()
      .then(setTitles)
      .catch(() => setTitles([]));
  }, [load]);

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (rowId: string, payload: ImportRowUpdate) =>
    run(async () => {
      setDetail(await historyService.updateImportRow(importId, rowId, payload));
    }, 'Could not save this row.');

  const saveTitles = (choices: ImportTitleChoice[]) =>
    run(async () => {
      setDetail(await historyService.setImportTitles(importId, choices));
      toast.success('Title answers saved');
    }, 'Could not save these titles.');

  const acceptSuggestions = () =>
    run(async () => {
      const decided = await historyService.acceptSuggestions(importId);
      toast.success(decided === 1 ? '1 row decided' : `${decided} rows decided`);
      setDetail(await historyService.getImport(importId));
    }, 'Could not apply the suggestions.');

  const commit = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: 'Import these people',
      message:
        'Every row is written to the archive as you decided. New records start as drafts, and existing records only gain what they are missing. This cannot be undone as a batch, but records nobody touches afterwards can be removed from this page.',
      confirmLabel: 'Import',
      cancelLabel: 'Keep reviewing',
      variant: 'info',
    });
    if (!ok) return;
    await run(async () => {
      await historyService.commitImport(importId);
      toast.success('Imported');
      setDetail(await historyService.getImport(importId));
    }, 'Could not import this file.');
  };

  const discard = async () => {
    const ok = await confirm({
      title: 'Discard this draft',
      message: 'The uploaded rows and every decision on them are deleted. Nothing was added to the archive.',
      confirmLabel: 'Discard draft',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      await historyService.discardImport(importId);
      toast.success('Draft discarded');
      void navigate('/history/import');
    }, 'Could not discard this draft.');
  };

  const removeRecords = async () => {
    const ok = await confirm({
      title: "Remove this import's records",
      message:
        'Deletes the records this import created that are still drafts and that nobody has edited, published, linked or reviewed since. Records the import only added to are not touched.',
      confirmLabel: 'Remove records',
      cancelLabel: 'Keep them',
      variant: 'danger',
    });
    if (!ok) return;
    await run(async () => {
      setRemoval(await historyService.removeImportRecords(importId));
      setDetail(await historyService.getImport(importId));
    }, 'Could not remove these records.');
  };

  const rows = useMemo(() => {
    const all = detail?.rows ?? [];
    if (filter === 'undecided') return all.filter((r) => r.decision === null);
    if (filter === 'problems') return all.filter((r) => r.problems.length > 0 && r.decision !== 'skip');
    return all;
  }, [detail, filter]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  if (error && !detail) {
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <div role="alert" className="alert-danger rounded-md p-3 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!detail) return <SkeletonPage />;

  const crumbs = (
    <Breadcrumbs
      items={[
        { label: 'History', path: '/history' },
        { label: 'Import', path: '/history/import' },
        { label: detail.source_filename },
      ]}
    />
  );

  if (detail.status !== 'draft') {
    const counts = detail.summary ?? {};
    return (
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        {crumbs}
        <h1 className="text-theme-text-primary mb-4 flex items-center gap-2 text-2xl font-bold">
          <FileUp className="h-6 w-6 shrink-0" aria-hidden="true" />
          {detail.source_filename}
        </h1>
        {detail.status === 'committed' ? (
          <section className="card p-4">
            <p className="text-theme-text-primary mb-2">
              Imported {detail.committed_at ? formatDate(detail.committed_at, tz) : ''}.
            </p>
            <ul className="text-theme-text-secondary mb-4 list-inside list-disc text-sm">
              {COUNT_LABELS.filter(([key]) => (counts[key] ?? 0) > 0).map(([key, label]) => (
                <li key={key}>
                  {counts[key]} {label}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/history/people"
                className="btn-secondary inline-flex items-center rounded-md px-3 py-2 text-sm"
              >
                Go to past members
              </Link>
              <button
                type="button"
                onClick={() => void removeRecords()}
                disabled={busy}
                className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                Remove this import&apos;s records
              </button>
            </div>
            {removal && (
              <div className="mt-4" role="status">
                <p className="text-theme-text-primary text-sm font-medium">
                  {removal.removed === 1 ? '1 record removed.' : `${removal.removed} records removed.`}
                  {removal.kept.length > 0 && ` ${removal.kept.length} kept:`}
                </p>
                {removal.kept.length > 0 && (
                  <ul className="text-theme-text-secondary mt-1 list-inside list-disc text-sm">
                    {removal.kept.map((k) => (
                      <li key={k.id}>
                        <Link to={`/history/people/${k.id}`} className="underline">
                          {k.display_name}
                        </Link>{' '}
                        — {k.reason.toLowerCase()}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        ) : (
          <p className="card text-theme-text-secondary p-4">
            {detail.status === 'expired'
              ? 'This draft went untouched for 30 days, so its rows were deleted. Upload the file again to start over.'
              : 'This draft was discarded. Upload the file again to start over.'}
          </p>
        )}
      </div>
    );
  }

  const undecided = detail.rows.filter((r) => r.decision === null).length;
  const shown = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl p-4 pb-24 sm:p-6">
      {crumbs}
      <div className="page-header mb-4">
        <h1 className="page-header-title text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <FileUp className="h-6 w-6 shrink-0" aria-hidden="true" />
          Review {detail.source_filename}
        </h1>
      </div>

      <section className="card mb-4 p-4" aria-labelledby="import-status-heading">
        <h2 id="import-status-heading" className="sr-only">
          Status
        </h2>
        <p className="text-theme-text-primary text-sm">
          {detail.row_count} {detail.row_count === 1 ? 'person' : 'people'} in the file
          {detail.expires_at && <> · deleted if left untouched until {formatDate(detail.expires_at, tz)}</>}
        </p>
        {detail.blockers.length > 0 ? (
          <ul className="text-theme-text-secondary mt-2 list-inside list-disc text-sm" aria-label="Still to do">
            {detail.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        ) : (
          <p className="text-theme-text-primary mt-2 text-sm font-medium">Ready to import.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {undecided > 0 && (
            <button
              type="button"
              onClick={() => void acceptSuggestions()}
              disabled={busy}
              className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Accept clear suggestions
            </button>
          )}
          <button
            type="button"
            onClick={() => void commit()}
            disabled={busy || !detail.ready}
            className="btn-primary rounded-md px-3 py-2 text-sm font-medium"
          >
            Import
          </button>
          <button
            type="button"
            onClick={() => void discard()}
            disabled={busy}
            className="btn-secondary inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Discard draft
          </button>
        </div>
        {undecided > 0 && (
          <p className="text-theme-text-secondary mt-2 text-xs">
            Accepting clear suggestions decides every row with exactly one suggestion, and makes a new record of every
            row with none. Rows with several possible matches are left for you.
          </p>
        )}
      </section>

      <ImportTitlesPanel titles={detail.titles} list={titles} disabled={busy} onSave={saveTitles} />

      <div className="tab-scroll mb-2" role="group" aria-label="Show rows">
        {(
          [
            ['all', `All (${detail.rows.length})`],
            ['undecided', `Need a decision (${undecided})`],
            [
              'problems',
              `With a problem (${detail.rows.filter((r) => r.problems.length > 0 && r.decision !== 'skip').length})`,
            ],
          ] as [RowFilter, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`touch-target-phone rounded-md px-3 py-1 text-sm ${
              filter === value ? 'btn-primary' : 'btn-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="card text-theme-text-secondary p-4 text-sm">No rows to show.</p>
      ) : (
        <ul className="card divide-theme-surface-border divide-y" aria-busy={busy}>
          {shown.map((row) => (
            <ImportRowCard key={row.id} row={row} disabled={busy} onUpdate={updateRow} />
          ))}
        </ul>
      )}
      {rows.length > PAGE_SIZE && (
        <div className="mt-4">
          <Pagination currentPage={page} totalItems={rows.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
};

export default HistoryImportReviewPage;
