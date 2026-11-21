/**
 * Naming who acts on an approval or calibration step (owner decision
 * 2026-11-16, ADV2-4).
 *
 * The evaluator never approves or calibrates their own evaluation, and nobody
 * signs two approvals on one revision. Where the only holder of a step's
 * position is barred, a manager names someone else; that person replaces the
 * position's holders for this step only. The list of who may be named comes
 * from the server, which applies the same rules signing does.
 */
import React, { useEffect, useState } from 'react';
import { Modal } from '../../../../components/Modal';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { evaluationsService } from '../../services/evaluationsApi';
import type { EvaluationStep, PersonRef } from '../../types/evaluations';

interface AssignStepDialogProps {
  evaluationId: string;
  /** The step being assigned; the dialog is closed while this is null. */
  step: EvaluationStep | null;
  busy: boolean;
  onClose: () => void;
  /** The chosen member's id, or null to hand the step back. */
  onAssign: (assigneeId: string | null) => void;
}

/** What "nobody named" means for this kind of step. */
function workflowActor(step: EvaluationStep): string {
  return step.type === 'calibration' ? 'any holder of evaluations.view_all' : "the holders of the step's position";
}

export const AssignStepDialog: React.FC<AssignStepDialogProps> = ({ evaluationId, step, busy, onClose, onAssign }) => {
  const [candidates, setCandidates] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState('');

  // Each opening starts from the step's current name and a fresh list, so a
  // choice made for one step is never filed against the next.
  useEffect(() => {
    if (!step) return undefined;
    let cancelled = false;
    setChoice(step.assignee?.id ?? '');
    setCandidates([]);
    setError(null);
    setLoading(true);
    evaluationsService
      .listStepAssigneeCandidates(evaluationId, step.key)
      .then((list) => {
        if (!cancelled) setCandidates(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load who may take this step.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [evaluationId, step]);

  if (!step) return null;

  const unchanged = choice === (step.assignee?.id ?? '');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onAssign(choice || null);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Who takes “${step.label}”`}
      onSubmit={submit}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || loading || unchanged || error !== null}>
            {choice ? 'Assign' : 'Hand back'}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-theme-text-primary">
          The person you name is the only one who can complete this step on this evaluation, in place of{' '}
          {workflowActor(step)}.
        </p>
        <p className="text-theme-text-secondary">
          The member and the evaluator cannot be named, and nobody signs two approvals on one evaluation. The change is
          recorded in the audit log, and the person named is emailed if the step is already open.
        </p>
        {error && (
          <p role="alert" className="alert-danger">
            {error}
          </p>
        )}
        <div>
          <label htmlFor="step-assignee" className="form-label">
            Completed by
          </label>
          <select
            id="step-assignee"
            className="form-input"
            value={choice}
            disabled={loading || error !== null}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="">No one named: {workflowActor(step)}</option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {loading && <p className="text-theme-text-secondary mt-1 text-xs">Loading members…</p>}
        </div>
      </div>
    </Modal>
  );
};
