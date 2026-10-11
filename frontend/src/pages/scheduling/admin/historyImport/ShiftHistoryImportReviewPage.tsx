/**
 * Shift History Import — review
 *
 * One draft import, as the backend currently reads it. Every decision made
 * here is saved on the draft immediately and the analysis comes back fresh, so
 * the page never computes a grouping or a match itself (pitfall #29): what it
 * shows is what the commit will write.
 *
 * Commit is offered only when nothing blocks it, and is final. A committed
 * import shows what it wrote and nothing more — its shifts are ordinary shifts
 * from then on.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileWarning } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import SchedulingHeader from '../../SchedulingHeader';
import { EmptyState, SkeletonPage } from '../../../../components/ux';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useTimezone } from '../../../../hooks/useTimezone';
import { historyImportService } from '../../../../modules/scheduling/services/historyImportApi';
import type {
  HistoryImportAnalysis,
  HistoryImportDetail,
  HistoryImportMappingsUpdate,
  HistoryImportRowUpdate,
  HistoryImportSettingsUpdate,
  MatchDecision,
} from '../../../../modules/scheduling/types/historyImport';
import { ExistingShiftStatus, HistoryImportStatus } from '../../../../modules/scheduling/types/historyImport';
import { formatDateTime } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { isSettled } from './historyImportLabels';
import { zoneLabel } from './historyImportTimezones';
import ReviewColumns from './ReviewColumns';
import ReviewMembers from './ReviewMembers';
import ReviewPositions from './ReviewPositions';
import ReviewRows from './ReviewRows';
import ReviewShifts from './ReviewShifts';
import ReviewUnits from './ReviewUnits';

type TabId = 'issues' | 'columns' | 'members' | 'units' | 'positions' | 'shifts' | 'rows';

/** Which tab settles an issue, by the backend's issue code. */
const ISSUE_TAB: Record<string, TabId> = {
  row_error: 'rows',
  overlapping_entries: 'rows',
  attendance_too_long: 'rows',
  probable_match: 'shifts',
  probable_existing_match: 'shifts',
  duplicate_member_in_shift: 'shifts',
  position_unmatched: 'positions',
  new_member_without_name: 'members',
  new_member_identifier_taken: 'members',
};

const issueTab = (code: string): TabId => {
  if (ISSUE_TAB[code]) return ISSUE_TAB[code] ?? 'rows';
  if (code.startsWith('member_')) return 'members';
  if (code.startsWith('unit_')) return 'units';
  return 'rows';
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="card-secondary p-3" role="group" aria-label={label}>
    <div className="text-theme-text-primary text-xl font-semibold">{value}</div>
    <div className="text-theme-text-secondary text-xs">{label}</div>
  </div>
);

const IssuesPanel: React.FC<{ analysis: HistoryImportAnalysis; onGo: (tab: TabId) => void }> = ({ analysis, onGo }) => {
  const blocking = analysis.issues.filter((i) => i.blocking);
  return (
    <section aria-labelledby="review-issues-heading" className="space-y-4">
      <h2 id="review-issues-heading" className="text-theme-text-primary text-lg font-semibold">
        Issues
      </h2>
      {blocking.length === 0 ? (
        <div className="alert-success flex items-center gap-2 rounded-lg p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          Nothing blocks this import.
        </div>
      ) : (
        <ul className="card divide-theme-surface-border divide-y">
          {blocking.slice(0, 300).map((issue, index) => (
            <li
              key={`${issue.code}-${issue.ref ?? ''}-${index}`}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="text-theme-text-primary text-sm">{issue.message}</span>
              <button type="button" className="btn-secondary shrink-0" onClick={() => onGo(issueTab(issue.code))}>
                Resolve
              </button>
            </li>
          ))}
        </ul>
      )}
      {blocking.length > 300 && (
        <p className="text-theme-text-secondary text-sm">
          Showing the first 300 of {blocking.length}. Settling a member or unit usually clears many at once.
        </p>
      )}
    </section>
  );
};

const ShiftHistoryImportReviewPage: React.FC = () => {
  const { importId = '' } = useParams<{ importId: string }>();
  const navigate = useNavigate();
  const viewerZone = useTimezone();
  const { confirm } = useConfirm();

  const [detail, setDetail] = useState<HistoryImportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>('issues');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await historyImportService.getImport(importId));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load this import'));
    } finally {
      setLoading(false);
    }
  }, [importId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Save one decision; the response is the whole re-analysed draft. */
  const apply = async (request: () => Promise<HistoryImportDetail>): Promise<boolean> => {
    setBusy(true);
    try {
      setDetail(await request());
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save that change'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onMappings = (payload: HistoryImportMappingsUpdate) =>
    void apply(() => historyImportService.updateMappings(importId, payload));
  const onSettings = (payload: HistoryImportSettingsUpdate) =>
    void apply(() => historyImportService.updateSettings(importId, payload));
  const onRowUpdate = (rowId: string, payload: HistoryImportRowUpdate) =>
    apply(() => historyImportService.updateRow(importId, rowId, payload));
  const onRowDecision = (rowId: string, decision: MatchDecision | null) =>
    void onRowUpdate(rowId, { match_decision: decision });
  /** One request per row; the last response is the draft with all of them applied. */
  const onSplit = (rowIds: string[]) =>
    void apply(async () => {
      let latest: HistoryImportDetail | null = null;
      for (const rowId of rowIds) {
        latest = await historyImportService.updateRow(importId, rowId, { keep_separate: true });
      }
      return latest ?? historyImportService.getImport(importId);
    });

  const handleCommit = async (analysis: HistoryImportAnalysis) => {
    const writing = analysis.counts.attendances + analysis.counts.external_entries - analysis.counts.duplicates;
    const created = analysis.members.filter((m) => m.status === 'create').length;
    const ok = await confirm({
      title: 'Commit this import?',
      message: (
        <div className="space-y-2">
          <p>
            This writes {analysis.counts.new_shifts} new shifts, adds members to {analysis.counts.existing_shifts}{' '}
            existing ones, and records {writing} attendance and outside-agency entries
            {created > 0 ? `, creating ${created} inactive member records` : ''}.
          </p>
          <p>
            <strong>This cannot be undone as a batch.</strong> After committing, imported shifts are corrected one at a
            time like any other shift.
          </p>
        </div>
      ),
      confirmLabel: 'Commit import',
      cancelLabel: 'Keep reviewing',
      variant: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await historyImportService.commit(importId);
      toast.success(
        `Imported ${result.summary?.attendance_created ?? 0} attendance records on ${
          (result.summary?.shifts_created ?? 0) + (result.summary?.shifts_updated ?? 0)
        } shifts`
      );
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not commit this import'));
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    const ok = await confirm({
      title: 'Discard this draft?',
      message: 'The draft and every decision made on it will be deleted. Nothing was written to the schedule.',
      confirmLabel: 'Discard draft',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await historyImportService.discard(importId);
      toast.success('Draft discarded');
      void navigate('/scheduling/admin/history-import');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not discard the draft'));
    }
  };

  const header = (
    <SchedulingHeader
      title="Review Shift History Import"
      backTo="/scheduling/admin/history-import"
      backLabel="Back to shift history imports"
      description={detail ? detail.import.source_filename : 'Loading…'}
    />
  );

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {header}
        {body}
      </div>
    </div>
  );

  if (loading && !detail) return shell(<SkeletonPage rows={6} />);
  if (loadError || !detail) {
    return shell(
      <EmptyState
        icon={FileWarning}
        title="This import could not be opened"
        description={loadError ?? 'It may have been discarded.'}
        actions={[{ label: 'Back to imports', onClick: () => void navigate('/scheduling/admin/history-import') }]}
      />
    );
  }

  const summary = detail.import;
  if (summary.status === HistoryImportStatus.COMMITTED || !detail.analysis) {
    const s = summary.summary ?? {};
    return shell(
      <section className="card space-y-4 p-4 sm:p-6" aria-labelledby="committed-heading">
        <div>
          <h2 id="committed-heading" className="text-theme-text-primary text-lg font-semibold">
            Committed {formatDateTime(summary.committed_at, viewerZone)}
          </h2>
          <p className="text-theme-text-secondary text-sm">
            This import is final. Correct any of its shifts from the schedule, one at a time.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Shifts created" value={s.shifts_created ?? 0} />
          <Stat label="Existing shifts added to" value={s.shifts_updated ?? 0} />
          <Stat label="Attendance records" value={s.attendance_created ?? 0} />
          <Stat label="Outside-agency entries" value={s.external_hours_created ?? 0} />
          <Stat label="Inactive members created" value={s.members_created ?? 0} />
          <Stat label="Outside units added" value={s.external_units_created ?? 0} />
          <Stat label="Already recorded (skipped)" value={s.duplicates_skipped ?? 0} />
          <Stat label="Rows skipped or excluded" value={(s.rows_skipped ?? 0) + (s.rows_excluded ?? 0)} />
        </div>
      </section>
    );
  }

  const analysis = detail.analysis;
  const pendingShifts = analysis.shifts.filter(
    (s) => s.existing_status === ExistingShiftStatus.PENDING || s.attendances.some((a) => a.needs_confirmation)
  ).length;
  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: 'issues', label: 'Issues', count: analysis.blocking_issue_count },
    { id: 'columns', label: 'Columns & time zone' },
    { id: 'members', label: 'Members', count: analysis.members.filter((m) => !isSettled(m.status)).length },
    { id: 'units', label: 'Units', count: analysis.units.filter((u) => !isSettled(u.status)).length },
    { id: 'positions', label: 'Positions', count: analysis.positions.filter((p) => !isSettled(p.status)).length },
    { id: 'shifts', label: 'Shifts', count: pendingShifts },
    { id: 'rows', label: 'Rows' },
  ];

  return shell(
    <div className="space-y-6">
      <section className="card space-y-4 p-4" aria-label="Import summary">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-theme-text-secondary text-sm">
            {analysis.counts.rows} rows · times read in {zoneLabel(summary.timezone)} ·{' '}
            {analysis.blocking_issue_count === 0
              ? 'ready to commit'
              : `${analysis.blocking_issue_count} issue${analysis.blocking_issue_count === 1 ? '' : 's'} to resolve`}
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => void handleDiscard()}>
              Discard draft
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !analysis.can_commit}
              onClick={() => void handleCommit(analysis)}
            >
              Commit import
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="New shifts" value={analysis.counts.new_shifts} />
          <Stat label="Existing shifts added to" value={analysis.counts.existing_shifts} />
          <Stat label="Outside-agency entries" value={analysis.counts.external_entries} />
          <Stat label="Already recorded (skipped)" value={analysis.counts.duplicates} />
        </div>
        {!analysis.can_commit && analysis.blocking_issue_count === 0 && (
          <p className="alert-info rounded-lg p-3 text-sm">
            Nothing in this file is new: every row is excluded, skipped or already recorded.
          </p>
        )}
      </section>

      <div className="tab-scroll" role="tablist" aria-label="Review sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`review-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls="review-tabpanel"
            onClick={() => setTab(t.id)}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-400'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            {t.label}
            {t.count ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      <div id="review-tabpanel" role="tabpanel" aria-labelledby={`review-tab-${tab}`} aria-busy={busy}>
        {tab === 'issues' && <IssuesPanel analysis={analysis} onGo={setTab} />}
        {tab === 'columns' && <ReviewColumns detail={detail} busy={busy} onSettings={onSettings} />}
        {tab === 'members' && <ReviewMembers analysis={analysis} busy={busy} onMappings={onMappings} />}
        {tab === 'units' && <ReviewUnits analysis={analysis} busy={busy} onMappings={onMappings} />}
        {tab === 'positions' && <ReviewPositions analysis={analysis} busy={busy} onMappings={onMappings} />}
        {tab === 'shifts' && (
          <ReviewShifts
            analysis={analysis}
            timezone={summary.timezone}
            busy={busy}
            onMappings={onMappings}
            onRowDecision={onRowDecision}
            onSplit={onSplit}
          />
        )}
        {tab === 'rows' && (
          <ReviewRows analysis={analysis} fields={detail.fields} busy={busy} onRowUpdate={onRowUpdate} />
        )}
      </div>
    </div>
  );
};

export default ShiftHistoryImportReviewPage;
