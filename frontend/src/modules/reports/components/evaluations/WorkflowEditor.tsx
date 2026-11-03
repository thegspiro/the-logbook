/**
 * The "Workflow & deadlines" tab of the template builder.
 *
 * Step order is fixed by kind — self-evaluation and evaluator, calibration,
 * approvals, then the member's acknowledgement — so steps are added into
 * their place rather than dragged. Steps never move backwards once an
 * evaluation is under way; a finalized evaluation changes only by amendment.
 */

import React from 'react';
import { EyeOff, Plus, Trash2 } from 'lucide-react';
import {
  EvaluationStepType,
  EvaluationTemplateKind,
  STEP_TYPE_LABELS,
  StepActorKind,
  type BuilderOptions,
  type TemplateWorkflow,
  type WorkflowStep,
} from '../../types/evaluations';
import { hasStep, insertStep, makeKey, replaceAt } from '../../utils/evaluationTemplate';

interface WorkflowEditorProps {
  workflow: TemplateWorkflow;
  kind: EvaluationTemplateKind;
  positions: BuilderOptions['positions'];
  onChange: (workflow: TemplateWorkflow) => void;
}

const ACTOR_TEXT: Record<StepActorKind, string> = {
  member: 'The member',
  evaluator: 'The assigned evaluator',
  view_all: 'Anyone who may read every evaluation',
  position: 'A position',
};

const STEP_NOTES: Record<EvaluationStepType, string> = {
  self_evaluation: 'Runs alongside the evaluator. The evaluator sees it only once the member submits it.',
  evaluator: 'Rates and writes. Can never be the member being evaluated.',
  calibration:
    'Hidden from the member. Flags go back to the evaluator before their part locks; only the fact that calibration was completed is kept.',
  approval: 'Reviews and signs.',
  member_acknowledgement:
    'The member acknowledges receipt — not agreement — or declines to sign with a reason. Either way the evaluation finalizes.',
};

const numberOr = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return value.trim() === '' || Number.isNaN(parsed) ? fallback : Math.max(0, Math.round(parsed));
};

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({ workflow, kind, positions, onChange }) => {
  const annual = kind === EvaluationTemplateKind.ANNUAL;
  const taken = workflow.steps.map((s) => s.key);

  const setStep = (index: number, step: WorkflowStep) =>
    onChange({ ...workflow, steps: replaceAt(workflow.steps, index, step) });

  const add = (type: EvaluationStepType) => {
    const firstPosition = positions[0]?.id ?? null;
    const label = type === EvaluationStepType.APPROVAL ? 'Approval' : STEP_TYPE_LABELS[type];
    const actor =
      type === EvaluationStepType.APPROVAL
        ? { kind: StepActorKind.POSITION, position_id: firstPosition }
        : type === EvaluationStepType.CALIBRATION
          ? { kind: StepActorKind.VIEW_ALL, position_id: null }
          : type === EvaluationStepType.EVALUATOR
            ? { kind: StepActorKind.EVALUATOR, position_id: null }
            : { kind: StepActorKind.MEMBER, position_id: null };
    onChange(insertStep(workflow, { key: makeKey(label, taken), type, label, actor, due_days: 0 }));
  };

  const addable: EvaluationStepType[] = [
    ...(!hasStep(workflow, EvaluationStepType.SELF_EVALUATION) ? [EvaluationStepType.SELF_EVALUATION] : []),
    ...(!hasStep(workflow, EvaluationStepType.EVALUATOR) ? [EvaluationStepType.EVALUATOR] : []),
    ...(annual && !hasStep(workflow, EvaluationStepType.CALIBRATION) ? [EvaluationStepType.CALIBRATION] : []),
    ...(annual && positions.length > 0 ? [EvaluationStepType.APPROVAL] : []),
    ...(annual && !hasStep(workflow, EvaluationStepType.MEMBER_ACKNOWLEDGEMENT)
      ? [EvaluationStepType.MEMBER_ACKNOWLEDGEMENT]
      : []),
  ];

  return (
    <div className="space-y-6">
      {!annual && (
        <p className="text-theme-text-secondary text-sm">
          A check-in has only the self-evaluation and evaluator steps, and no signatures.
        </p>
      )}
      <ol className="card divide-theme-surface-border divide-y">
        {workflow.steps.map((step, index) => (
          <li key={step.key} className="grid gap-4 p-4 md:grid-cols-[14rem_1fr_9rem_auto] md:items-start">
            <div>
              <label htmlFor={`step-${step.key}-label`} className="form-label-sm">
                {index + 1}. {STEP_TYPE_LABELS[step.type]}
              </label>
              <input
                id={`step-${step.key}-label`}
                className="form-input-sm w-full"
                maxLength={100}
                value={step.label}
                onChange={(e) => setStep(index, { ...step, label: e.target.value })}
              />
              {step.type === EvaluationStepType.CALIBRATION && (
                <span className="badge text-theme-text-secondary mt-2 bg-slate-500/15">
                  <EyeOff className="mr-1 h-3 w-3" aria-hidden="true" />
                  Hidden from member
                </span>
              )}
            </div>
            <div>
              {step.type === EvaluationStepType.APPROVAL ? (
                <>
                  <label htmlFor={`step-${step.key}-actor`} className="form-label-sm">
                    Who acts
                  </label>
                  <select
                    id={`step-${step.key}-actor`}
                    className="form-input-sm w-full"
                    value={step.actor.position_id ?? ''}
                    onChange={(e) =>
                      setStep(index, { ...step, actor: { kind: 'position', position_id: e.target.value } })
                    }
                  >
                    {positions.map((position) => (
                      <option key={position.id} value={position.id}>
                        Position: {position.name}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <>
                  <span className="form-label-sm">Who acts</span>
                  <p className="text-theme-text-primary text-sm">{ACTOR_TEXT[step.actor.kind]}</p>
                </>
              )}
              <p className="text-theme-text-muted mt-1 text-xs">{STEP_NOTES[step.type]}</p>
            </div>
            <div>
              <label htmlFor={`step-${step.key}-due`} className="form-label-sm">
                Due (days after period ends)
              </label>
              <input
                id={`step-${step.key}-due`}
                type="number"
                min={0}
                max={365}
                className="form-input-sm w-full"
                value={step.due_days}
                onChange={(e) => setStep(index, { ...step, due_days: numberOr(e.target.value, step.due_days) })}
              />
            </div>
            <button
              type="button"
              className="btn-icon self-end"
              aria-label={`Remove ${step.label}`}
              onClick={() => onChange({ ...workflow, steps: workflow.steps.filter((_, i) => i !== index) })}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
        {addable.length > 0 && (
          <li className="flex flex-wrap gap-2 p-4">
            {addable.map((type) => (
              <button key={type} type="button" className="btn-secondary btn-sm" onClick={() => add(type)}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {STEP_TYPE_LABELS[type]}
              </button>
            ))}
          </li>
        )}
      </ol>
      <p className="text-theme-text-muted text-xs">
        Steps run in this order and later steps cannot be due before earlier ones. Once a step is completed it never
        moves back; a finalized evaluation can only be changed by amendment.
      </p>

      <div className="card grid gap-4 p-4 sm:p-6 md:grid-cols-2">
        <div>
          <label htmlFor="reminder-days" className="form-label">
            Reminder email (days before each deadline)
          </label>
          <input
            id="reminder-days"
            type="number"
            min={0}
            max={30}
            className="form-input"
            value={workflow.reminder_days_before}
            onChange={(e) =>
              onChange({
                ...workflow,
                reminder_days_before: Math.min(30, numberOr(e.target.value, workflow.reminder_days_before)),
              })
            }
          />
        </div>
        {annual && (
          <div>
            <label htmlFor="response-window" className="form-label">
              Member&rsquo;s written response window after finalization (days)
            </label>
            <input
              id="response-window"
              type="number"
              min={0}
              max={365}
              className="form-input"
              value={workflow.response_window_days}
              onChange={(e) =>
                onChange({
                  ...workflow,
                  response_window_days: Math.min(365, numberOr(e.target.value, workflow.response_window_days)),
                })
              }
            />
          </div>
        )}
        <label className="flex items-start gap-2 text-sm md:col-span-2">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={workflow.evaluator_may_proceed_without_self_evaluation}
            onChange={(e) => onChange({ ...workflow, evaluator_may_proceed_without_self_evaluation: e.target.checked })}
          />
          <span className="text-theme-text-secondary">
            If the self-evaluation deadline is missed, let the evaluator continue without it (the record notes it was
            not submitted)
          </span>
        </label>
      </div>
    </div>
  );
};
