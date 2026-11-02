/**
 * Evaluations a member conducts — or every evaluation, for a holder of
 * `evaluations.view_all` or `evaluations.manage` — and the dialog that drafts
 * one. The server decides which rows the caller may list.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { evaluationsService } from '../services/evaluationsApi';
import { EvaluationTemplateKind, type DraftOptions, type EvaluationSummary } from '../types/evaluations';

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
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm | null>(null);
  const [options, setOptions] = useState<DraftOptions | null>(null);
  const [saving, setSaving] = useState(false);

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
        <Link
          to="/reports"
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Reports
        </Link>
        <div className="page-header mb-6 gap-3 sm:items-start">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-3xl font-bold">Evaluations</h1>
            <p className="text-theme-text-secondary mt-1">Evaluations you conduct, and where each one stands.</p>
          </div>
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
        </div>

        <div className="mb-4 flex items-center gap-2">
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
                </tr>
              </thead>
              <tbody>
                {evaluations.map((evaluation) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
