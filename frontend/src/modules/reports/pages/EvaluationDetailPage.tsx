/**
 * One evaluation, as the signed-in member may see it.
 *
 * The server decides what this viewer may read and do (`viewer`); the page
 * renders that and nothing more. The member's self-evaluation and the
 * evaluator's part are each saved as drafts and locked by submitting; a
 * submitted part cannot be changed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { EvaluationForm } from '../components/evaluations/EvaluationForm';
import { FiguresPanel } from '../components/evaluations/FiguresPanel';
import { StepList } from '../components/evaluations/StepList';
import { evaluationsService } from '../services/evaluationsApi';
import type { EvaluationDetail, EvaluationPartKind, PartContent } from '../types/evaluations';
import { emptyContent } from '../utils/evaluationRecord';

const PART_TITLES: Record<string, string> = {
  self_evaluation: 'Self-evaluation',
  evaluator: 'Evaluation',
};

const SUBMIT_MESSAGES: Record<string, string> = {
  submitted: 'Submitted',
  sent_for_calibration: 'Sent to calibration',
  finalized: 'Submitted — the evaluation is complete',
};

function editableKind(detail: EvaluationDetail): EvaluationPartKind | null {
  if (detail.viewer.can_edit_evaluation) return 'evaluator';
  if (detail.viewer.can_edit_self_evaluation) return 'self_evaluation';
  return null;
}

const EvaluationDetailPage: React.FC = () => {
  const { evaluationId = '' } = useParams();
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartContent>(emptyContent());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  // Edits made while a save is in flight must not be replaced by the older
  // response the save returns.
  const editRevision = useRef(0);

  const adopt = useCallback((next: EvaluationDetail, revisionAtRequest: number | null) => {
    setDetail(next);
    if (revisionAtRequest !== null && revisionAtRequest !== editRevision.current) return;
    const kind = editableKind(next);
    const part = kind ? next.parts.find((p) => p.kind === kind) : undefined;
    setDraft(part ? part.content : emptyContent());
    setDirty(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    evaluationsService
      .get(evaluationId)
      .then((loaded) => {
        if (!cancelled) adopt(loaded, null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load this evaluation.'));
      });
    return () => {
      cancelled = true;
    };
  }, [evaluationId, adopt]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="alert-danger">
          <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!detail) {
    return <p className="text-theme-text-secondary px-4 py-8 text-sm">Loading evaluation…</p>;
  }

  const kind = editableKind(detail);
  const readOnlyParts = detail.parts.filter((p) => p.kind !== kind && p.kind in PART_TITLES);

  const onEdit = (content: PartContent) => {
    editRevision.current += 1;
    setDraft(content);
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    if (!kind) return false;
    const revision = editRevision.current;
    setBusy(true);
    try {
      adopt(await evaluationsService.savePart(detail.id, kind, draft), revision);
      toast.success('Saved');
      return true;
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!kind) return;
    const ok = await confirm({
      title: kind === 'evaluator' ? 'Submit the evaluation?' : 'Submit your self-evaluation?',
      message:
        kind === 'evaluator'
          ? 'Submitting locks your ratings and comments. If the form has a calibration step, it goes to calibration first and you lock it afterwards.'
          : 'Submitting locks your self-evaluation and shares it with your evaluator. You cannot change it afterwards.',
      confirmLabel: 'Submit',
      cancelLabel: 'Keep editing',
    });
    if (!ok) return;
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      const result = await evaluationsService.submitPart(detail.id, kind);
      adopt(result.evaluation, null);
      toast.success(SUBMIT_MESSAGES[result.outcome] ?? 'Submitted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not submit.'));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      adopt(await evaluationsService.refreshData(detail.id), editRevision.current);
      toast.success('Figures updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the figures.'));
    } finally {
      setBusy(false);
    }
  };

  const calibrate = async () => {
    const ok = await confirm({
      title: 'Mark calibration complete?',
      message:
        'The evaluator can then lock the evaluation. Discuss any changes with the evaluator directly; only the fact that calibration happened is recorded.',
      confirmLabel: 'Mark complete',
      cancelLabel: 'Not yet',
    });
    if (!ok) return;
    setBusy(true);
    try {
      adopt(await evaluationsService.completeCalibration(detail.id), editRevision.current);
      toast.success('Calibration recorded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record calibration.'));
    } finally {
      setBusy(false);
    }
  };

  const backTo = detail.viewer.is_member ? '/reports/evaluations/mine' : '/reports/evaluations/conduct';

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to={backTo}
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {detail.viewer.is_member ? 'My evaluations' : 'Evaluations'}
        </Link>
        <div className="page-header mb-6 gap-3 sm:items-start">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-3xl font-bold">
              {detail.viewer.is_member ? 'My evaluation' : detail.member.name}
            </h1>
            <p className="text-theme-text-secondary mt-1">
              {detail.template_name} · {detail.period_name ?? 'One-off'} ({formatCalendarDate(detail.period_start)} –{' '}
              {formatCalendarDate(detail.period_end)}){detail.evaluator ? ` · Evaluator: ${detail.evaluator.name}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.viewer.can_refresh_data && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => void refresh()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Update figures
              </button>
            )}
            {detail.viewer.can_calibrate && (
              <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => void calibrate()}>
                Mark calibration complete
              </button>
            )}
          </div>
        </div>

        {detail.status === 'finalized' && (
          <div className="alert-success mb-6">
            <p className="text-theme-alert-success-text text-sm">This evaluation is complete.</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            {kind && (
              <section aria-labelledby="editing-heading" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="editing-heading" className="text-theme-text-primary text-xl font-semibold">
                    {kind === 'evaluator' ? 'Your evaluation' : 'Your self-evaluation'}
                  </h2>
                  <span className="text-theme-text-secondary text-sm" role="status">
                    {dirty ? 'Unsaved changes' : 'All changes saved'}
                  </span>
                </div>
                <EvaluationForm
                  kind={kind}
                  definition={detail.definition}
                  content={draft}
                  onChange={onEdit}
                  readOnly={false}
                  data={detail.data}
                  sources={detail.sources}
                  suggested={detail.suggested_scores}
                  overallLevels={detail.overall_levels}
                />
                <div className="action-bar-safe flex flex-wrap justify-end gap-2">
                  <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => void save()}>
                    Save draft
                  </button>
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
                    Submit
                  </button>
                </div>
              </section>
            )}

            {readOnlyParts.map((part) => (
              <section key={part.kind} aria-labelledby={`part-${part.kind}`} className="space-y-4">
                <h2 id={`part-${part.kind}`} className="text-theme-text-primary text-xl font-semibold">
                  {PART_TITLES[part.kind]}
                  {part.status === 'draft' && (
                    <span className="badge ml-2 bg-amber-500/20 text-amber-900 dark:text-amber-300">Draft</span>
                  )}
                </h2>
                {part.kind === 'evaluator' && detail.weighted_overall !== null && (
                  <p className="text-theme-text-primary text-sm">
                    Weighted overall: <span className="font-semibold">{detail.weighted_overall}%</span>
                  </p>
                )}
                <EvaluationForm
                  kind={part.kind as EvaluationPartKind}
                  definition={detail.definition}
                  content={part.content}
                  readOnly
                  data={detail.data}
                  sources={detail.sources}
                  suggested={detail.suggested_scores}
                  overallLevels={detail.overall_levels}
                />
              </section>
            ))}

            {!kind && readOnlyParts.length === 0 && (
              <p className="text-theme-text-secondary text-sm">
                {detail.viewer.is_member
                  ? 'Your evaluation will appear here once your evaluator has completed it.'
                  : 'Nothing has been submitted yet.'}
              </p>
            )}
          </div>

          <div className="space-y-6">
            <StepList steps={detail.steps} />
            {detail.data && (
              <FiguresPanel
                title="Figures"
                sources={detail.sources}
                data={detail.data}
                coverageStart={detail.coverage_start}
                coverageEnd={detail.coverage_end}
                excluded={detail.excluded_ranges}
                footnote={detail.data_taken_at ? `Taken ${formatDateTime(detail.data_taken_at, tz)}` : undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EvaluationDetailPage;
