/**
 * Intake questions on a suggestion box: which are shown, and where the answers
 * send the submission.
 *
 * Visibility is not decided here. Questions are mapped onto the forms module's
 * `ConditionalField` and handed to `getVisibleFieldIds`, the same function the
 * form renderers use and the frontend twin of the rule the server applies, so
 * the browser cannot show a question the server then ignores.
 */

import { SuggestionIntakeQuestionType } from '../../../constants/enums';
import { getVisibleFieldIds, type ConditionalField } from '../../../utils/formVisibility';
import type { IntakeQuestion } from '../types/suggestions';

const ROUTING_TYPES: readonly string[] = [SuggestionIntakeQuestionType.SELECT, SuggestionIntakeQuestionType.RADIO];

/** An editor question always has an id, so follow-ups can point at it. */
export type EditableQuestion = IntakeQuestion & { id: string };

/**
 * New questions get their id in the editor rather than on save, so a
 * follow-up can branch from a question added in the same edit. The server
 * keeps a supplied id.
 */
export function newQuestionId(): string {
  return crypto.randomUUID();
}

export function withEditorIds(questions: readonly IntakeQuestion[] | undefined): EditableQuestion[] {
  return (questions ?? []).map((q) => ({ ...q, id: q.id || newQuestionId() }));
}

/** Questions that have been saved, and so have an id answers can be keyed by. */
export function savedQuestions(questions: readonly IntakeQuestion[] | undefined): (IntakeQuestion & { id: string })[] {
  return (questions ?? []).filter((q): q is IntakeQuestion & { id: string } => Boolean(q.id));
}

export function toConditionalFields(questions: readonly (IntakeQuestion & { id: string })[]): ConditionalField[] {
  return questions.map((q) => ({
    id: q.id,
    field_type: q.type,
    condition_field_id: q.conditionQuestionId ?? null,
    condition_operator: q.conditionOperator ?? null,
    condition_value: q.conditionValue ?? null,
  }));
}

export function visibleQuestionIds(
  questions: readonly IntakeQuestion[] | undefined,
  values: Readonly<Record<string, string>>
): Set<string> {
  return getVisibleFieldIds(toConditionalFields(savedQuestions(questions)), values);
}

/**
 * The answers to send: shown questions only, blanks left out. An answer to a
 * question the member has since hidden belongs to a branch they backed out of.
 */
export function answersToSend(
  questions: readonly IntakeQuestion[] | undefined,
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const visible = visibleQuestionIds(questions, values);
  const out: Record<string, string> = {};
  for (const question of savedQuestions(questions)) {
    const value = (values[question.id] ?? '').trim();
    if (visible.has(question.id) && value) out[question.id] = value;
  }
  return out;
}

/**
 * The box the answers route to, or null. Mirrors `resolve_answers` in
 * `backend/app/services/suggestion_intake.py`: the first shown single-choice
 * answer naming a box wins, in question order. This only previews the route
 * for the member; the server decides it.
 */
export function resolveRoute(
  questions: readonly IntakeQuestion[] | undefined,
  values: Readonly<Record<string, string>>
): string | null {
  const visible = visibleQuestionIds(questions, values);
  for (const question of savedQuestions(questions)) {
    if (!visible.has(question.id) || !ROUTING_TYPES.includes(question.type)) continue;
    const value = (values[question.id] ?? '').trim();
    if (!value) continue;
    const option = question.options.find((o) => o.value === value);
    if (option?.routeToBoxId) return option.routeToBoxId;
  }
  return null;
}
