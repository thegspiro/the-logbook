/**
 * One evaluation, as the signed-in member may see it.
 *
 * The server decides what this viewer may read and do (`viewer`); the page
 * renders that and nothing more. The member's self-evaluation and the
 * evaluator's part are each saved as drafts and locked by submitting; a
 * submitted part cannot be changed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Download, FilePenLine, PenLine, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { conductListLabel } from '../../../components/layout/evaluationsNavigation';
import { useSectionPermission } from '../../../components/layout/useSectionPermission';
import { useAuthStore } from '../../../stores/authStore';
import { formatCalendarDate, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { saveBlob } from '../../../utils/saveBlob';
import { AmendEvaluationDialog } from '../components/evaluations/AmendEvaluationDialog';
import { CalibrationDialog } from '../components/evaluations/CalibrationDialog';
import { DeleteEvaluationDialog } from '../components/evaluations/DeleteEvaluationDialog';
import { EvaluationForm } from '../components/evaluations/EvaluationForm';
import { FiguresPanel } from '../components/evaluations/FiguresPanel';
import { ResponsePanel } from '../components/evaluations/ResponsePanel';
import { SignDialog } from '../components/evaluations/SignDialog';
import { StepList } from '../components/evaluations/StepList';
import { evaluationsService } from '../services/evaluationsApi';
import type {
  EvaluationDetail,
  EvaluationPartKind,
  PartContent,
  SignatureWrite,
  SigningOption,
} from '../types/evaluations';
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

const DISPOSITION_LABELS: Record<string, string> = {
  signed: 'Signed',
  acknowledged: 'Acknowledged receipt',
  refused: 'Refused to sign',
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
  const [signing, setSigning] = useState<SigningOption | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [amending, setAmending] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const navigate = useNavigate();
  const signerName = useAuthStore((state) => state.user?.full_name ?? '');
  const sectionPermission = useSectionPermission();
  const conductLabel = conductListLabel(sectionPermission);
  // A crew supervisor reads an evaluation by relationship and may hold no
  // evaluations grant, so the conduct list would refuse them: their way back
  // is the crew page that linked here.
  const readsAsOfficer = ['evaluations.conduct', 'evaluations.view_all', 'evaluations.manage'].some((permission) =>
    sectionPermission(permission)
  );
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

  const calibrate = async (flaggedItems: string[]) => {
    setBusy(true);
    try {
      adopt(await evaluationsService.completeCalibration(detail.id, flaggedItems), editRevision.current);
      setCalibrating(false);
      toast.success('Calibration recorded');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record calibration.'));
    } finally {
      setBusy(false);
    }
  };

  const sign = async (signature: SignatureWrite) => {
    setBusy(true);
    try {
      const result = await evaluationsService.sign(detail.id, signature);
      adopt(result.evaluation, null);
      setSigning(null);
      toast.success(result.outcome === 'finalized' ? 'Signed — the evaluation is complete' : 'Signed');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not record your signature.'));
    } finally {
      setBusy(false);
    }
  };

  const amend = async (reason: string) => {
    setBusy(true);
    try {
      adopt(await evaluationsService.amend(detail.id, reason), null);
      setAmending(false);
      toast.success('Evaluation reopened for amendment');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not amend the evaluation.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (reason: string) => {
    setBusy(true);
    try {
      await evaluationsService.remove(detail.id, reason);
      toast.success('Evaluation deleted');
      void navigate('/reports/evaluations/conduct');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not delete the evaluation.'));
      setBusy(false);
    }
  };

  const saveResponse = async (text: string) => {
    setBusy(true);
    try {
      adopt(await evaluationsService.saveResponse(detail.id, text), null);
      toast.success('Response saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save your response.'));
    } finally {
      setBusy(false);
    }
  };

  const submitResponse = async () => {
    const ok = await confirm({
      title: 'Submit your response?',
      message:
        'Your response becomes part of the record and is printed on the evaluation’s PDF. You cannot change it afterwards. Your evaluator and the evaluation managers are told.',
      confirmLabel: 'Submit response',
      cancelLabel: 'Keep editing',
    });
    if (!ok) return;
    setBusy(true);
    try {
      adopt(await evaluationsService.submitResponse(detail.id), null);
      toast.success('Response submitted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not submit your response.'));
    } finally {
      setBusy(false);
    }
  };

  const download = async (version: 'latest' | 'signed' = 'latest') => {
    setBusy(true);
    try {
      const suffix = version === 'latest' && detail.response_document_available ? '-with-response' : '';
      saveBlob(await evaluationsService.document(detail.id, version), `evaluation-${detail.period_end}${suffix}.pdf`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not download the PDF.'));
    } finally {
      setBusy(false);
    }
  };

  const backTo = detail.viewer.is_member
    ? '/reports/evaluations/mine'
    : readsAsOfficer
      ? '/reports/evaluations/conduct'
      : '/members/my-crew';
  const backLabel = detail.viewer.is_member ? 'My evaluations' : readsAsOfficer ? conductLabel : 'My crew';

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to={backTo}
          className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
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
            {detail.viewer.can_sign && (
              <button
                type="button"
                className="btn-primary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => setSigning(detail.viewer.can_sign ?? null)}
              >
                <PenLine className="h-4 w-4" aria-hidden="true" />
                {detail.viewer.can_sign.label}
              </button>
            )}
            {detail.document_available && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => void download()}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download PDF
              </button>
            )}
            {detail.response_document_available && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => void download('signed')}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Signed PDF, without response
              </button>
            )}
            {detail.viewer.can_calibrate && (
              <button
                type="button"
                className="btn-primary text-sm"
                disabled={busy}
                onClick={() => setCalibrating(true)}
              >
                Mark calibration complete
              </button>
            )}
            {detail.viewer.can_amend && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => setAmending(true)}
              >
                <FilePenLine className="h-4 w-4" aria-hidden="true" />
                Amend
              </button>
            )}
            {detail.viewer.can_delete && (
              <button
                type="button"
                className="btn-secondary inline-flex items-center gap-2 text-sm"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
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
                  flagged={detail.calibration_flags}
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
                  flagged={detail.calibration_flags}
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
            <ResponsePanel
              detail={detail}
              busy={busy}
              onSave={(text) => void saveResponse(text)}
              onSubmit={() => void submitResponse()}
            />
            <StepList steps={detail.steps} />
            {(detail.amendments ?? []).length > 0 && (
              <section aria-labelledby="amendments-heading" className="card p-4 sm:p-6">
                <h2 id="amendments-heading" className="text-theme-text-primary text-lg font-semibold">
                  Amendments
                </h2>
                <p className="text-theme-text-secondary mt-1 text-xs">
                  Reopened after it was final. The earlier text was not kept.
                </p>
                <ul className="mt-3 space-y-3">
                  {(detail.amendments ?? []).map((amendment) => (
                    <li key={amendment.to_revision} className="text-sm">
                      <span className="text-theme-text-secondary block">
                        Revision {amendment.to_revision}: amended by {amendment.amended_by_name},{' '}
                        {formatDateTime(amendment.amended_at, tz)}
                      </span>
                      <span className="text-theme-text-primary block whitespace-pre-wrap">
                        Reason: {amendment.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {detail.signatures.length > 0 && (
              <section aria-labelledby="signatures-heading" className="card p-4 sm:p-6">
                <h2 id="signatures-heading" className="text-theme-text-primary text-lg font-semibold">
                  Signatures
                </h2>
                <ul className="mt-3 space-y-3">
                  {detail.signatures.map((signature) => (
                    <li key={signature.step_key} className="text-sm">
                      <span className="text-theme-text-primary font-medium">{signature.label}</span>
                      <span className="text-theme-text-secondary block">
                        {DISPOSITION_LABELS[signature.disposition] ?? signature.disposition} by{' '}
                        <span className="font-serif italic">{signature.signed_name}</span>,{' '}
                        {formatDateTime(signature.signed_at, tz)}
                      </span>
                      {signature.comment && (
                        <span className="text-theme-text-primary block whitespace-pre-wrap">
                          Reason: {signature.comment}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
      <SignDialog
        option={signing}
        signerName={signerName}
        busy={busy}
        onClose={() => setSigning(null)}
        onSign={(signature) => void sign(signature)}
      />
      <CalibrationDialog
        isOpen={calibrating}
        definition={detail.definition}
        busy={busy}
        onClose={() => setCalibrating(false)}
        onComplete={(flaggedItems) => void calibrate(flaggedItems)}
      />
      <AmendEvaluationDialog
        isOpen={amending}
        memberName={detail.member.name}
        busy={busy}
        onClose={() => setAmending(false)}
        onAmend={(reason) => void amend(reason)}
      />
      <DeleteEvaluationDialog
        isOpen={deleting}
        memberName={detail.member.name}
        finalized={detail.status === 'finalized'}
        busy={busy}
        onClose={() => setDeleting(false)}
        onDelete={(reason) => void remove(reason)}
      />
    </div>
  );
};

export default EvaluationDetailPage;
