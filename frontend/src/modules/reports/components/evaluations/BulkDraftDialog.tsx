/**
 * Drafting a whole review period at once (owner decision 2026-11-02: preview,
 * then exclude).
 *
 * The server lists every current member with the template and evaluator it
 * would use, or why it leaves them out. The manager unticks anyone they do
 * not want drafted, picks an evaluator where none qualifies by default, and
 * drafts the rest; each draft stands alone, so the result lists any member
 * who could not be drafted and why.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationsService } from '../../services/evaluationsApi';
import {
  EvaluationTemplateKind,
  type BulkDraftPreview,
  type BulkDraftResponse,
  type DraftOptions,
} from '../../types/evaluations';

interface BulkDraftDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a draft run that created at least one evaluation. */
  onDrafted: () => void;
}

interface Choice {
  included: boolean;
  evaluatorId: string;
}

export const BulkDraftDialog: React.FC<BulkDraftDialogProps> = ({ isOpen, onClose, onDrafted }) => {
  const [options, setOptions] = useState<DraftOptions | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [kind, setKind] = useState<EvaluationTemplateKind>(EvaluationTemplateKind.ANNUAL);
  const [preview, setPreview] = useState<BulkDraftPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [result, setResult] = useState<BulkDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each open starts over, so a preview taken for one period is never drafted
  // against another.
  useEffect(() => {
    if (!isOpen) return;
    setPeriodId('');
    setKind(EvaluationTemplateKind.ANNUAL);
    setPreview(null);
    setChoices({});
    setResult(null);
    setError(null);
    if (options) return;
    evaluationsService
      .draftOptions()
      .then(setOptions)
      .catch((err: unknown) => setError(getErrorMessage(err, 'Could not load the review periods.')));
  }, [isOpen, options]);

  const names = useMemo(() => new Map((preview?.rows ?? []).map((row) => [row.member.id, row.member.name])), [preview]);

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await evaluationsService.bulkPreview(periodId, kind);
      setPreview(loaded);
      setChoices(
        Object.fromEntries(
          loaded.rows
            .filter((row) => !row.skip_reason)
            .map((row) => [row.member.id, { included: true, evaluatorId: row.evaluator?.id ?? '' }])
        )
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not prepare the drafts.'));
    } finally {
      setBusy(false);
    }
  };

  const selected = Object.entries(choices).filter(([, choice]) => choice.included);
  const missingEvaluator = selected.some(([, choice]) => !choice.evaluatorId);

  const draftAll = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const response = await evaluationsService.bulkDraft(
        preview.period.id,
        preview.kind,
        selected.map(([memberId, choice]) => ({ member_id: memberId, evaluator_id: choice.evaluatorId || undefined }))
      );
      setResult(response);
      if (response.drafted > 0) onDrafted();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not draft the evaluations.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (result) {
      onClose();
    } else if (preview) {
      void draftAll();
    } else {
      void loadPreview();
    }
  };

  const failures = (result?.results ?? []).filter((r) => r.error);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Draft a review period"
      size="xl"
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          {!result && (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
          {result ? (
            <button type="submit" className="btn-primary">
              Done
            </button>
          ) : preview ? (
            <button type="submit" className="btn-primary" disabled={busy || selected.length === 0 || missingEvaluator}>
              Draft {selected.length} {selected.length === 1 ? 'evaluation' : 'evaluations'}
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={busy || !periodId}>
              Preview members
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {error && <p className="alert-danger text-theme-alert-danger-text text-sm">{error}</p>}

        {result ? (
          <div className="space-y-3 text-sm">
            <p className="text-theme-text-primary">
              Drafted {result.drafted} {result.drafted === 1 ? 'evaluation' : 'evaluations'}. Each member and evaluator
              has been emailed that their part is open.
            </p>
            {failures.length > 0 && (
              <div>
                <p className="text-theme-text-primary font-medium">Not drafted</p>
                <ul className="text-theme-text-secondary list-disc pl-5">
                  {failures.map((failure) => (
                    <li key={failure.member_id}>
                      {names.get(failure.member_id) ?? 'A member'}: {failure.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : !preview ? (
          <>
            <div>
              <label htmlFor="bulk-period" className="form-label">
                Review period
              </label>
              <select
                id="bulk-period"
                className="form-input"
                required
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="">Choose a period…</option>
                {(options?.periods ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCalendarDate(p.start_date)} – {formatCalendarDate(p.end_date)})
                  </option>
                ))}
              </select>
              {options && options.periods.length === 0 && (
                <p className="text-theme-text-secondary mt-1 text-xs">No review period is open.</p>
              )}
            </div>
            <div>
              <label htmlFor="bulk-kind" className="form-label">
                Kind
              </label>
              <select
                id="bulk-kind"
                className="form-input"
                value={kind}
                onChange={(e) => setKind(e.target.value as EvaluationTemplateKind)}
              >
                <option value={EvaluationTemplateKind.ANNUAL}>Annual evaluation</option>
                <option value={EvaluationTemplateKind.INTERIM}>Check-in</option>
              </select>
            </div>
            <p className="text-theme-text-secondary text-xs">
              You will see every current member, the form and evaluator each would get, and anyone left out and why,
              before anything is drafted.
            </p>
          </>
        ) : (
          <>
            <p className="text-theme-text-secondary text-sm">
              {preview.period.name}: untick anyone you do not want drafted. Members left out can be drafted one at a
              time from New evaluation, where a form can be chosen.
            </p>
            <ul className="divide-theme-surface-border divide-y text-sm">
              {preview.rows.map((row) => {
                const choice = choices[row.member.id];
                const checkboxId = `bulk-member-${row.member.id}`;
                return (
                  <li key={row.member.id} className="flex flex-wrap items-start gap-3 py-2">
                    <input
                      id={checkboxId}
                      type="checkbox"
                      className="form-checkbox mt-1"
                      disabled={!choice}
                      checked={choice?.included ?? false}
                      onChange={(e) =>
                        choice && setChoices({ ...choices, [row.member.id]: { ...choice, included: e.target.checked } })
                      }
                    />
                    <label htmlFor={checkboxId} className="min-w-40 flex-1">
                      <span className="text-theme-text-primary font-medium">{row.member.name}</span>
                      <span className="text-theme-text-secondary block text-xs">
                        {row.skip_reason ?? row.template?.name}
                      </span>
                    </label>
                    {choice && (
                      <div className="w-full sm:w-56">
                        <label htmlFor={`bulk-evaluator-${row.member.id}`} className="sr-only">
                          Evaluator for {row.member.name}
                        </label>
                        <select
                          id={`bulk-evaluator-${row.member.id}`}
                          className="form-input-sm w-full"
                          value={choice.evaluatorId}
                          disabled={!choice.included}
                          onChange={(e) =>
                            setChoices({ ...choices, [row.member.id]: { ...choice, evaluatorId: e.target.value } })
                          }
                        >
                          <option value="">Choose an evaluator…</option>
                          {preview.evaluators
                            .filter((e) => e.id !== row.member.id)
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            {missingEvaluator && (
              <p className="text-theme-text-secondary text-xs">
                Choose an evaluator for each ticked member who has none, or untick them.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};
