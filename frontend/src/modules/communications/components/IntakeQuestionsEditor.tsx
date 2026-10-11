/**
 * The questions a suggestion box asks on submission, as an administrator
 * edits them.
 *
 * A question can be shown only when an earlier answer matches (the forms
 * module's branching rule), and a dropdown or single-choice option can send
 * the submission to another box, where only that box's reviewers read it.
 */

import React from 'react';
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from 'lucide-react';
import {
  SUGGESTION_INTAKE_QUESTION_TYPE_LABELS,
  SuggestionAnonymityMode,
  SuggestionIntakeQuestionType,
} from '../../../constants/enums';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { CONDITION_OPERATORS_WITH_VALUE, getDescendantFieldIds } from '../../../utils/formVisibility';
import type { IntakeOption } from '../types/suggestions';
import { type EditableQuestion, newQuestionId, toConditionalFields } from '../utils/suggestionRouting';

// Mirror MAX_INTAKE_QUESTIONS / MAX_INTAKE_OPTIONS / MAX_INTAKE_LABEL_LENGTH /
// MAX_INTAKE_HELP_LENGTH in backend/app/schemas/suggestion.py.
const MAX_QUESTIONS = 25;
const MAX_OPTIONS = 25;
const MAX_LABEL_LENGTH = 200;
const MAX_HELP_LENGTH = 500;

const CHOICE_TYPES: readonly string[] = [
  SuggestionIntakeQuestionType.SELECT,
  SuggestionIntakeQuestionType.RADIO,
  SuggestionIntakeQuestionType.CHECKBOX,
];
const ROUTING_TYPES: readonly string[] = [SuggestionIntakeQuestionType.SELECT, SuggestionIntakeQuestionType.RADIO];

const CONDITION_OPERATORS = [
  { value: 'equals', label: 'is' },
  { value: 'not_equals', label: 'is not' },
  { value: 'contains', label: 'includes' },
  { value: 'not_empty', label: 'is answered' },
  { value: 'is_empty', label: 'is not answered' },
];

export interface RouteTarget {
  id: string;
  name: string;
  anonymityMode: string;
}

interface IntakeQuestionsEditorProps {
  questions: EditableQuestion[];
  onChange: (questions: EditableQuestion[]) => void;
  /** Every other box in the department. */
  routeTargets: RouteTarget[];
  anonymityMode: string;
}

/**
 * An option's value is a stable key, not its wording: a follow-up question
 * branches on the value, so rewording an option must not break the branch.
 * Members and reviewers only ever see the label. Hex has no comma, which the
 * server refuses inside a value because checkbox answers are comma-joined.
 */
function newOptionValue(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

const IntakeQuestionsEditor: React.FC<IntakeQuestionsEditorProps> = ({
  questions,
  onChange,
  routeTargets,
  anonymityMode,
}) => {
  const { confirm } = useConfirm();
  const fields = toConditionalFields(questions);

  // A box that promises anonymity cannot send a submission to one that
  // records names; the server refuses the same pairing.
  const allowedTargets = routeTargets.filter(
    (t) => anonymityMode !== SuggestionAnonymityMode.REQUIRED || t.anonymityMode !== SuggestionAnonymityMode.DISABLED
  );

  const update = (id: string, patch: Partial<EditableQuestion>) =>
    onChange(questions.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  /** Clear the branch rule of every question that depends on `parentId`
   * (optionally only those comparing against `value`). */
  const releaseDependents = (list: EditableQuestion[], parentId: string, value?: string) =>
    list.map((q) =>
      q.conditionQuestionId === parentId && (value === undefined || q.conditionValue === value)
        ? { ...q, conditionQuestionId: null, conditionOperator: null, conditionValue: null }
        : q
    );

  const addQuestion = () =>
    onChange([
      ...questions,
      {
        id: newQuestionId(),
        label: '',
        type: SuggestionIntakeQuestionType.RADIO,
        required: false,
        options: [],
        helpText: null,
        conditionQuestionId: null,
        conditionOperator: null,
        conditionValue: null,
      },
    ]);

  const removeQuestion = async (question: EditableQuestion) => {
    const dependents = questions.filter((q) => q.conditionQuestionId === question.id).length;
    const ok = await confirm({
      title: 'Remove question',
      message:
        dependents > 0
          ? `“${question.label || 'Untitled question'}” has ${dependents} follow-up question${
              dependents === 1 ? '' : 's'
            }. They will be kept and shown to everyone.`
          : `Remove “${question.label || 'Untitled question'}”? Answers already submitted keep it.`,
      confirmLabel: 'Remove question',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    onChange(releaseDependents(questions, question.id).filter((q) => q.id !== question.id));
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= questions.length) return;
    const next = [...questions];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    onChange(next);
  };

  const changeType = (question: EditableQuestion, type: EditableQuestion['type']) => {
    const isChoice = CHOICE_TYPES.includes(type);
    const options = isChoice
      ? question.options.map((o) => (ROUTING_TYPES.includes(type) ? o : { ...o, routeToBoxId: null }))
      : [];
    // A follow-up comparing against an option no longer offered could never
    // appear; release it rather than leave it unreachable.
    const released = isChoice ? questions : releaseDependents(questions, question.id);
    onChange(released.map((q) => (q.id === question.id ? { ...q, type, options } : q)));
  };

  const setOptions = (question: EditableQuestion, options: IntakeOption[]) => update(question.id, { options });

  const renameOption = (question: EditableQuestion, index: number, label: string) =>
    setOptions(
      question,
      question.options.map((o, i) => (i === index ? { ...o, label } : o))
    );

  const removeOption = (question: EditableQuestion, index: number) => {
    const removed = question.options[index];
    const next = removed ? releaseDependents(questions, question.id, removed.value) : questions;
    onChange(next.map((q) => (q.id === question.id ? { ...q, options: q.options.filter((_, i) => i !== index) } : q)));
  };

  return (
    <section aria-labelledby="box-questions-heading" className="border-theme-surface-border space-y-4 border-t pt-4">
      <div>
        <h3 id="box-questions-heading" className="text-theme-text-primary text-sm font-semibold">
          Questions
        </h3>
        <p className="text-theme-text-muted mt-1 text-xs">
          Asked before the title and details. A question can appear only after a particular answer, and a dropdown or
          single-choice answer can send the submission to another box — only that box&apos;s reviewers then read it.
        </p>
      </div>

      {questions.map((question, index) => {
        const prefix = `intake-q-${question.id}`;
        const isChoice = CHOICE_TYPES.includes(question.type);
        const canRoute = ROUTING_TYPES.includes(question.type);
        const ownBranch = getDescendantFieldIds(fields, question.id);
        const parents = questions.filter((q) => !ownBranch.has(q.id));
        const parent = questions.find((q) => q.id === question.conditionQuestionId);
        const needsValue = CONDITION_OPERATORS_WITH_VALUE.includes(question.conditionOperator ?? '');

        return (
          <fieldset key={question.id} className="border-theme-surface-border space-y-3 rounded-md border p-3">
            <legend className="text-theme-text-secondary px-1 text-xs font-medium">Question {index + 1}</legend>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-60">
                <label htmlFor={`${prefix}-label`} className="form-label">
                  Question
                </label>
                <input
                  id={`${prefix}-label`}
                  className="form-input"
                  value={question.label}
                  maxLength={MAX_LABEL_LENGTH}
                  required
                  onChange={(e) => update(question.id, { label: e.target.value })}
                  placeholder="e.g. Is this a safety concern?"
                />
              </div>
              <div className="basis-44">
                <label htmlFor={`${prefix}-type`} className="form-label">
                  Answer type
                </label>
                <select
                  id={`${prefix}-type`}
                  className="form-input"
                  value={question.type}
                  onChange={(e) => changeType(question, e.target.value as EditableQuestion['type'])}
                >
                  {Object.values(SuggestionIntakeQuestionType).map((type) => (
                    <option key={type} value={type}>
                      {SUGGESTION_INTAKE_QUESTION_TYPE_LABELS[type] ?? type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move question ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Move question ${index + 1} down`}
                  disabled={index === questions.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`Remove question ${index + 1}`}
                  onClick={() => void removeQuestion(question)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div>
              <label htmlFor={`${prefix}-help`} className="form-label">
                Help text <span className="text-theme-text-muted font-normal">(optional)</span>
              </label>
              <input
                id={`${prefix}-help`}
                className="form-input"
                value={question.helpText ?? ''}
                maxLength={MAX_HELP_LENGTH}
                onChange={(e) => update(question.id, { helpText: e.target.value || null })}
              />
            </div>

            <label className="text-theme-text-primary touch:min-h-[44px] flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={question.required}
                onChange={(e) => update(question.id, { required: e.target.checked })}
              />
              Required when shown
            </label>

            {isChoice && (
              <div className="space-y-2">
                <span className="form-label">Options</span>
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Option ${optionIndex + 1}`}
                      className="form-input min-w-0 flex-1 basis-40"
                      value={option.label}
                      maxLength={MAX_LABEL_LENGTH}
                      required
                      onChange={(e) => renameOption(question, optionIndex, e.target.value)}
                    />
                    {canRoute && (
                      <select
                        aria-label={`Where option ${optionIndex + 1} sends the submission`}
                        className="form-input min-w-0 flex-1 basis-40"
                        value={option.routeToBoxId ?? ''}
                        onChange={(e) =>
                          setOptions(
                            question,
                            question.options.map((o, i) =>
                              i === optionIndex ? { ...o, routeToBoxId: e.target.value || null } : o
                            )
                          )
                        }
                      >
                        <option value="">Keep in this box</option>
                        {allowedTargets.map((target) => (
                          <option key={target.id} value={target.id}>
                            Send to {target.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      className="btn-icon"
                      aria-label={`Remove option ${optionIndex + 1}`}
                      onClick={() => removeOption(question, optionIndex)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
                    disabled={question.options.length >= MAX_OPTIONS}
                    onClick={() => setOptions(question, [...question.options, { value: newOptionValue(), label: '' }])}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    Add option
                  </button>
                  {question.options.length === 0 && (
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-sm"
                      onClick={() =>
                        setOptions(question, [
                          { value: 'yes', label: 'Yes' },
                          { value: 'no', label: 'No' },
                        ])
                      }
                    >
                      Use Yes / No
                    </button>
                  )}
                </div>
              </div>
            )}

            {parents.length > 0 && (
              <div className="space-y-2">
                <span className="text-theme-text-secondary flex items-center gap-1 text-xs font-medium">
                  <GitBranch className="h-4 w-4" aria-hidden="true" />
                  Show this question
                </span>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Show only after this question"
                    className="form-input min-w-0 flex-1 basis-48"
                    value={question.conditionQuestionId ?? ''}
                    onChange={(e) =>
                      update(question.id, {
                        conditionQuestionId: e.target.value || null,
                        conditionOperator: e.target.value ? 'equals' : null,
                        conditionValue: null,
                      })
                    }
                  >
                    <option value="">Always</option>
                    {parents.map((p) => (
                      <option key={p.id} value={p.id}>
                        When “{p.label || 'Untitled question'}”
                      </option>
                    ))}
                  </select>
                  {parent && (
                    <select
                      aria-label="Rule"
                      className="form-input min-w-0 basis-36"
                      value={question.conditionOperator ?? 'equals'}
                      onChange={(e) =>
                        update(question.id, {
                          conditionOperator: e.target.value,
                          conditionValue: CONDITION_OPERATORS_WITH_VALUE.includes(e.target.value)
                            ? question.conditionValue
                            : null,
                        })
                      }
                    >
                      {CONDITION_OPERATORS.map((op) => (
                        <option key={op.value} value={op.value}>
                          {op.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {parent &&
                    needsValue &&
                    (CHOICE_TYPES.includes(parent.type) ? (
                      <select
                        aria-label="Answer"
                        className="form-input min-w-0 flex-1 basis-40"
                        value={question.conditionValue ?? ''}
                        required
                        onChange={(e) => update(question.id, { conditionValue: e.target.value || null })}
                      >
                        <option value="">Choose an answer…</option>
                        {parent.options
                          .filter((o) => o.value)
                          .map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <input
                        aria-label="Answer"
                        className="form-input min-w-0 flex-1 basis-40"
                        value={question.conditionValue ?? ''}
                        maxLength={MAX_LABEL_LENGTH}
                        required
                        onChange={(e) => update(question.id, { conditionValue: e.target.value || null })}
                      />
                    ))}
                </div>
              </div>
            )}
          </fieldset>
        );
      })}

      <button
        type="button"
        className="btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-sm"
        disabled={questions.length >= MAX_QUESTIONS}
        onClick={addQuestion}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add question
      </button>
    </section>
  );
};

export default IntakeQuestionsEditor;
