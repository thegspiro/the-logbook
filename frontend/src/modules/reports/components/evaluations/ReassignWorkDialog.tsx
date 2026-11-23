/**
 * Handing one person's open work in a review period to another, for an
 * evaluator or approver who has left or changed role (owner decision
 * 2026-11-21).
 *
 * The manager picks the period, whose work to hand over (people holding open
 * work there, a former member included) and who takes it, and sees what
 * would move and what would be skipped and why before anything changes. The
 * server decides both from one rule, so the preview is what the change does;
 * a re-verified session is asked for by the API client when it is needed.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationPeriodsService, evaluationsService } from '../../services/evaluationsApi';
import type {
  EvaluationPeriod,
  PersonRef,
  ReassignmentHolder,
  ReassignmentPlan,
  ReassignmentRow,
} from '../../types/evaluations';

interface ReassignWorkDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a reassignment that moved at least one evaluation. */
  onReassigned: () => void;
}

const movedWork = (row: ReassignmentRow): string =>
  [row.moves_evaluator ? 'Evaluator' : null, ...row.steps].filter(Boolean).join(', ');

export const ReassignWorkDialog: React.FC<ReassignWorkDialogProps> = ({ isOpen, onClose, onReassigned }) => {
  const [periods, setPeriods] = useState<EvaluationPeriod[] | null>(null);
  const [members, setMembers] = useState<PersonRef[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [holders, setHolders] = useState<ReassignmentHolder[] | null>(null);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [preview, setPreview] = useState<ReassignmentPlan | null>(null);
  const [result, setResult] = useState<ReassignmentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each open starts over, so a preview taken for one hand-over is never
  // applied to another.
  useEffect(() => {
    if (!isOpen) return;
    setPeriodId('');
    setHolders(null);
    setFromId('');
    setToId('');
    setPreview(null);
    setResult(null);
    setError(null);
    Promise.all([evaluationPeriodsService.list(), evaluationsService.draftOptions()])
      .then(([loadedPeriods, options]) => {
        setPeriods(loadedPeriods);
        setMembers(options.members);
      })
      .catch((err: unknown) => setError(getErrorMessage(err, 'Could not load the review periods.')));
  }, [isOpen]);

  useEffect(() => {
    setHolders(null);
    setFromId('');
    setPreview(null);
    if (!periodId) return;
    let current = true;
    evaluationsService
      .reassignmentHolders(periodId)
      .then((loaded) => {
        if (current) setHolders(loaded);
      })
      .catch((err: unknown) => {
        if (current) setError(getErrorMessage(err, 'Could not load who holds open work.'));
      });
    return () => {
      current = false;
    };
  }, [periodId]);

  const loadPreview = async () => {
    setBusy(true);
    setError(null);
    try {
      setPreview(await evaluationsService.reassignmentPreview(periodId, fromId, toId));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not preview the hand-over.'));
    } finally {
      setBusy(false);
    }
  };

  const moving = (preview?.rows ?? []).filter((row) => !row.skipped_reason);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await evaluationsService.reassign(periodId, fromId, toId);
      setResult(done);
      if (done.rows.some((row) => !row.skipped_reason)) onReassigned();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not hand the work over.'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (result) onClose();
    else if (preview) void apply();
    else void loadPreview();
  };

  const rowsList = (rows: ReassignmentRow[]) => (
    <ul className="divide-theme-surface-border divide-y text-sm">
      {rows.map((row) => (
        <li key={row.evaluation_id} className="py-2">
          <span className="text-theme-text-primary font-medium">{row.member_name}</span>
          <span className="text-theme-text-secondary block text-xs">
            {row.skipped_reason ? `Skipped: ${row.skipped_reason}` : movedWork(row)}
          </span>
        </li>
      ))}
    </ul>
  );

  const shown = result ?? preview;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Hand over open work"
      size="lg"
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
            <button type="submit" className="btn-primary" disabled={busy || moving.length === 0}>
              Hand over {moving.length} {moving.length === 1 ? 'evaluation' : 'evaluations'}
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={busy || !periodId || !fromId || !toId}>
              Preview
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {error && <p className="alert-danger text-theme-alert-danger-text text-sm">{error}</p>}

        {shown ? (
          <>
            <p className="text-theme-text-primary text-sm">
              {result
                ? result.rows.some((row) => !row.skipped_reason)
                  ? `Handed the work below from ${result.from_name} to ${result.to_name}. They have been emailed about any step already open.`
                  : `Nothing was handed from ${result.from_name} to ${result.to_name}.`
                : `From ${shown.from_name} to ${shown.to_name}. A draft the evaluator started stays for ${shown.to_name} to finish.`}
            </p>
            {shown.rows.length === 0 ? (
              <p className="text-theme-text-secondary text-sm">{shown.from_name} holds no open work in this period.</p>
            ) : (
              rowsList(shown.rows)
            )}
          </>
        ) : (
          <>
            <div>
              <label htmlFor="reassign-period" className="form-label">
                Review period
              </label>
              <select
                id="reassign-period"
                className="form-input"
                required
                value={periodId}
                onChange={(e) => setPeriodId(e.target.value)}
              >
                <option value="">Choose a period…</option>
                {(periods ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCalendarDate(p.start_date)} – {formatCalendarDate(p.end_date)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="reassign-from" className="form-label">
                Hand over the work of
              </label>
              <select
                id="reassign-from"
                className="form-input"
                required
                disabled={!holders}
                value={fromId}
                onChange={(e) => setFromId(e.target.value)}
              >
                <option value="">Choose…</option>
                {(holders ?? []).map((h) => (
                  <option key={h.user_id} value={h.user_id}>
                    {h.name} ({h.evaluations} {h.evaluations === 1 ? 'evaluation' : 'evaluations'})
                  </option>
                ))}
              </select>
              {holders && holders.length === 0 && (
                <p className="text-theme-text-secondary mt-1 text-xs">Nobody holds open work in this period.</p>
              )}
            </div>
            <div>
              <label htmlFor="reassign-to" className="form-label">
                To
              </label>
              <select
                id="reassign-to"
                className="form-input"
                required
                value={toId}
                onChange={(e) => setToId(e.target.value)}
              >
                <option value="">Choose…</option>
                {members
                  .filter((m) => m.id !== fromId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </div>
            <p className="text-theme-text-secondary text-xs">
              Moves evaluations they have not yet submitted as evaluator, and approval or calibration steps naming them.
              Steps that go to a position&apos;s holders are not moved. You will see what moves, and what cannot and
              why, before anything changes.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
};
