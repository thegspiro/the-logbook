/**
 * Evaluations a member conducts — or every evaluation, for a holder of
 * `evaluations.view_all` or `evaluations.manage` — the dialog that drafts one,
 * the manager's dialog that drafts a whole review period, and the records of
 * deleted evaluations. The server decides which rows the caller may list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipboardList, Download, FileArchive, Plus, UserRoundCog, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { conductListLabel } from '../../../components/layout/evaluationsNavigation';
import { EvaluationsPageHeader } from '../components/evaluations/EvaluationsPageHeader';
import { BulkDraftDialog } from '../components/evaluations/BulkDraftDialog';
import { ReassignWorkDialog } from '../components/evaluations/ReassignWorkDialog';
import { DeletionRecordList } from '../components/evaluations/DeletionRecordList';
import { evaluationsService } from '../services/evaluationsApi';
import { gradeCounts } from '../utils/evaluationRecord';
import { GradeSpreadPanel } from '../components/evaluations/GradeSpreadPanel';
import {
  EvaluationTemplateKind,
  type DraftOptions,
  type EvaluationDeletionRecord,
  type EvaluationSummary,
} from '../types/evaluations';

interface DraftForm {
  member_id: string;
  period_id: string;
  evaluator_id: string;
  kind: EvaluationTemplateKind;
}

const EMPTY_DRAFT: DraftForm = { member_id: '', period_id: '', evaluator_id: '', kind: EvaluationTemplateKind.ANNUAL };

const EvaluationListPage: React.FC = () => {
  const navigate = useNavigate();
  const canManage = useAuthStore((state) => state.checkPermission('evaluations.manage'));
  const canDraft = useAuthStore(
    (state) => state.checkPermission('evaluations.conduct') || state.checkPermission('evaluations.manage')
  );
  const title = useAuthStore((state) => conductListLabel(state.checkPermission));
  // Grades are personnel content: the server sends them only to view_all.
  const canViewAll = useAuthStore((state) => state.checkPermission('evaluations.view_all'));
  const [periodId, setPeriodId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [bundling, setBundling] = useState(false);
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [options, setOptions] = useState<DraftOptions | null>(null);
  const [saving, setSaving] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false);
  const canSeeRemoved = useAuthStore(
    (state) =>
      state.checkPermission('evaluations.view_all') ||
      state.checkPermission('evaluations.manage') ||
      state.checkPermission('evaluations.delete')
  );
  const [removed, setRemoved] = useState<EvaluationDeletionRecord[]>([]);
  const [removedError, setRemovedError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEvaluations(await evaluationsService.list({ status: status || undefined }));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Could not load evaluations.'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Loaded apart from the list, so a failure here never hides the evaluations.
  useEffect(() => {
    if (!canSeeRemoved) return;
    evaluationsService
      .removed()
      .then(setRemoved)
      .catch((err: unknown) => setRemovedError(getErrorMessage(err, 'Could not load deleted evaluations.')));
  }, [canSeeRemoved]);

  const periods = [
    ...new Map(
      evaluations
        .filter((e) => e.period_id)
        .map((e) => [e.period_id ?? '', e.period_name ?? formatCalendarDate(e.period_end)] as const)
    ).entries(),
  ];
  const shown = periodId ? evaluations.filter((e) => e.period_id === periodId) : evaluations;
  const finalizedCount = shown.filter((e) => e.status === 'finalized').length;

  const exportPeriod = async () => {
    if (!periodId) return;
    setExporting(true);
    try {
      saveBlob(await evaluationsService.exportPeriod(periodId), 'evaluation-results.csv');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not export the review period.'));
    } finally {
      setExporting(false);
    }
  };

  // The signed copies only, as signed; the server asks for a re-verified
  // session first, which the API client handles.
  const exportPdfs = async () => {
    if (!periodId) return;
    setBundling(true);
    try {
      saveBlob(await evaluationsService.exportPeriodPdfs(periodId), 'evaluation-pdfs.zip');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the signed PDFs.'));
    } finally {
      setBundling(false);
    }
  };

  const openDraft = async () => {
    setDraft(EMPTY_DRAFT);
    if (options) return;
    try {
      setOptions(await evaluationsService.draftOptions());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load members and review periods.'));
      setDraft(null);
    }
  };

  const submitDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const created = await evaluationsService.create({
        member_id: draft.member_id,
        period_id: draft.period_id,
        evaluator_id: draft.evaluator_id || undefined,
        kind: draft.kind,
      });
      toast.success('Evaluation drafted');
      setDraft(null);
      void navigate(`/reports/evaluations/${created.id}`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not draft the evaluation.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <EvaluationsPageHeader
          icon={ClipboardList}
          title={title}
          subtitle={
            title === 'All evaluations'
              ? 'Every evaluation in the department, and where each one stands.'
              : 'Evaluations you conduct, and where each one stands.'
          }
          actions={
            <>
              {canManage && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                  onClick={() => setBulkOpen(true)}
                >
                  <Users className="h-4 w-4" aria-hidden="true" />
                  Draft a review period
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                  onClick={() => setReassignOpen(true)}
                >
                  <UserRoundCog className="h-4 w-4" aria-hidden="true" />
                  Hand over work
                </button>
              )}
              {canDraft && (
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2 text-sm"
                  onClick={() => void openDraft()}
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  New evaluation
                </button>
              )}
            </>
          }
        />

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <label htmlFor="evaluation-status" className="text-theme-text-secondary text-sm">
              Show
            </label>
            <select
              id="evaluation-status"
              className="form-input w-48"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All</option>
              <option value="in_progress">In progress</option>
              <option value="finalized">Complete</option>
            </select>
          </div>
          {periods.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="evaluation-period" className="text-theme-text-secondary text-sm">
                Period
              </label>
              <select
                id="evaluation-period"
                className="form-input w-56"
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="">All periods</option>
                {periods.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {canViewAll && periodId && (
          <section aria-labelledby="period-results-heading" className="card mb-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id="period-results-heading" className="text-theme-text-primary text-base font-semibold">
                  Period results
                </h2>
                <p className="text-theme-text-secondary text-sm">
                  {finalizedCount} of {shown.length} complete
                  {status ? ' (of those shown)' : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                  disabled={exporting}
                  onClick={() => void exportPeriod()}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  {exporting ? 'Exporting…' : 'Export CSV'}
                </button>
                <button
                  type="button"
                  className="btn-secondary inline-flex items-center gap-2 text-sm"
                  disabled={bundling || finalizedCount === 0}
                  onClick={() => void exportPdfs()}
                >
                  <FileArchive className="h-4 w-4" aria-hidden="true" />
                  {bundling ? 'Preparing…' : 'Download signed PDFs'}
                </button>
              </div>
            </div>
            {gradeCounts(shown).length > 0 && (
              <dl className="mt-3 flex flex-wrap gap-2 text-sm">
                {gradeCounts(shown).map(({ label, count }) => (
                  <div key={label} className="card-secondary px-3 py-2">
                    <dt className="text-theme-text-secondary text-xs">{label}</dt>
                    <dd className="text-theme-text-primary font-semibold">{count}</dd>
                  </div>
                ))}
              </dl>
            )}
            <GradeSpreadPanel periodId={periodId} />
          </section>
        )}

        {loadError && (
          <div className="alert-danger mb-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {loading && evaluations.length === 0 ? (
          <p className="text-theme-text-secondary text-sm">Loading evaluations…</p>
        ) : evaluations.length === 0 && !loadError ? (
          <EmptyState
            title="No evaluations"
            description={canDraft ? 'Draft one for a member and a review period.' : 'None to show yet.'}
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="rwd-table w-full text-sm">
              <thead className="bg-theme-surface-secondary text-theme-text-secondary text-left text-xs uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Period
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Evaluator
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Waiting on
                  </th>
                  {canViewAll && (
                    <th scope="col" className="px-4 py-3">
                      Overall grade
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {shown.map((evaluation) => (
                  <tr key={evaluation.id} className="border-theme-surface-border border-t">
                    <td data-label="Member" className="px-4 py-3">
                      <Link
                        to={`/reports/evaluations/${evaluation.id}`}
                        className="text-theme-text-primary font-medium underline-offset-2 hover:underline"
                      >
                        {evaluation.member.name}
                      </Link>
                      <span className="text-theme-text-secondary block text-xs">{evaluation.template_name}</span>
                    </td>
                    <td data-label="Period" className="text-theme-text-secondary px-4 py-3">
                      {evaluation.period_name ?? formatCalendarDate(evaluation.period_end)}
                    </td>
                    <td data-label="Evaluator" className="text-theme-text-secondary px-4 py-3">
                      {evaluation.evaluator?.name ?? '—'}
                    </td>
                    <td data-label="Waiting on" className="text-theme-text-secondary px-4 py-3">
                      {evaluation.status === 'finalized'
                        ? 'Complete'
                        : evaluation.current_step
                          ? `${evaluation.current_step}${evaluation.current_step_due ? ` · due ${formatCalendarDate(evaluation.current_step_due)}` : ''}`
                          : '—'}
                    </td>
                    {canViewAll && (
                      <td data-label="Overall grade" className="text-theme-text-primary px-4 py-3">
                        {evaluation.overall_grade ?? '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canSeeRemoved && (removed.length > 0 || removedError) && (
          <section aria-labelledby="removed-heading" className="mt-8">
            <h2 id="removed-heading" className="text-theme-text-primary mb-1 text-xl font-semibold">
              Deleted evaluations
            </h2>
            <p className="text-theme-text-secondary mb-3 text-sm">
              Each deletion stays on the member&apos;s history with its reason, and the member can read it.
            </p>
            {removedError ? (
              <p className="text-theme-alert-danger-text text-sm">{removedError}</p>
            ) : (
              <DeletionRecordList records={removed} showMember />
            )}
          </section>
        )}
      </div>

      <BulkDraftDialog isOpen={bulkOpen} onClose={() => setBulkOpen(false)} onDrafted={() => void load()} />
      <ReassignWorkDialog
        isOpen={reassignOpen}
        onClose={() => setReassignOpen(false)}
        onReassigned={() => void load()}
      />

      <Modal
        isOpen={draft !== null}
        onClose={() => setDraft(null)}
        title="New evaluation"
        onSubmit={(event) => void submitDraft(event)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving || !options}>
              Draft evaluation
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4">
            {!options ? (
              <p className="text-theme-text-secondary text-sm">Loading…</p>
            ) : (
              <>
                <div>
                  <label htmlFor="draft-member" className="form-label">
                    Member
                  </label>
                  <select
                    id="draft-member"
                    className="form-input"
                    required
                    value={draft.member_id}
                    onChange={(e) => setDraft({ ...draft, member_id: e.target.value })}
                  >
                    <option value="">Choose a member…</option>
                    {options.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="draft-period" className="form-label">
                    Review period
                  </label>
                  <select
                    id="draft-period"
                    className="form-input"
                    required
                    value={draft.period_id}
                    onChange={(e) => setDraft({ ...draft, period_id: e.target.value })}
                  >
                    <option value="">Choose a period…</option>
                    {options.periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCalendarDate(p.start_date)} – {formatCalendarDate(p.end_date)})
                      </option>
                    ))}
                  </select>
                  {options.periods.length === 0 && (
                    <p className="text-theme-text-secondary mt-1 text-xs">No review period is open.</p>
                  )}
                </div>
                <div>
                  <label htmlFor="draft-kind" className="form-label">
                    Kind
                  </label>
                  <select
                    id="draft-kind"
                    className="form-input"
                    value={draft.kind}
                    onChange={(e) => setDraft({ ...draft, kind: e.target.value as EvaluationTemplateKind })}
                  >
                    <option value={EvaluationTemplateKind.ANNUAL}>Annual evaluation</option>
                    <option value={EvaluationTemplateKind.INTERIM}>Check-in</option>
                  </select>
                </div>
                {canManage && (
                  <div>
                    <label htmlFor="draft-evaluator" className="form-label">
                      Evaluator
                    </label>
                    <select
                      id="draft-evaluator"
                      className="form-input"
                      value={draft.evaluator_id}
                      onChange={(e) => setDraft({ ...draft, evaluator_id: e.target.value })}
                    >
                      <option value="">The member&apos;s supervisor, or you</option>
                      {options.evaluators
                        .filter((e) => e.id !== draft.member_id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <p className="text-theme-text-secondary text-xs">
                  The form is chosen from the member&apos;s class and status, and the figures are taken now.
                  {canManage ? '' : ' You will be the evaluator.'}
                </p>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default EvaluationListPage;
