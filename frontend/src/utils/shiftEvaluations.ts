/**
 * Helpers for filling out and reading shift evaluations.
 *
 * `shiftEvaluationProblems` mirrors the server's submit check
 * (`ShiftEvaluationService._settle_answers`) so the page can say what is left
 * before it asks. The server is still the authority: a submission it refuses
 * comes back as an error, whatever this said.
 */

import type {
  ShiftEvaluationAverage,
  ShiftEvaluationFormSnapshot,
  ShiftEvaluationItemAnswer,
  ShiftEvaluationStatistic,
  ShiftEvaluationTemplateItem,
} from '../types/training';

export const SHIFT_EVALUATION_STATISTIC_LABELS: Record<ShiftEvaluationStatistic, string> = {
  calls: 'Number of Calls',
  transports: 'Number of Transports',
  refusals: 'Number of Refusals',
};

/** What the evaluation page edits. Numbers are kept as typed text until saved. */
export interface ShiftEvaluationDraft {
  header_values: Record<string, string>;
  statistics: Partial<Record<ShiftEvaluationStatistic, string>>;
  responses: Record<string, ShiftEvaluationItemAnswer>;
  closing_comments: string;
}

export const shiftEvaluationPagePath = (shiftId: string, memberId: string, scopeKey: string): string =>
  `/scheduling/shift-reports/${encodeURIComponent(shiftId)}/evaluations/${encodeURIComponent(
    memberId
  )}/${encodeURIComponent(scopeKey)}`;

export const shiftEvaluationPrintPath = (evaluationId: string): string =>
  `/scheduling/shift-evaluations/print?id=${encodeURIComponent(evaluationId)}`;

/** Every item on the form, in order, with its section's title. */
export function shiftEvaluationItems(
  form: ShiftEvaluationFormSnapshot
): { sectionTitle: string; item: ShiftEvaluationTemplateItem & { key: string } }[] {
  return form.sections.flatMap((section) =>
    section.items
      .filter((item): item is ShiftEvaluationTemplateItem & { key: string } => Boolean(item.key))
      .map((item) => ({ sectionTitle: section.title, item }))
  );
}

/** Whether an item's answer needs a comment under the form's rules. */
export function commentRequired(
  form: ShiftEvaluationFormSnapshot,
  item: ShiftEvaluationTemplateItem,
  answer: ShiftEvaluationItemAnswer | undefined
): boolean {
  if (item.comment_always_required) return true;
  const threshold = form.comment_required_at_or_below;
  return answer?.rating != null && threshold != null && answer.rating <= threshold;
}

/** A typed count, or undefined when the box is blank or not a whole number. */
export function parseCount(text: string | undefined): number | undefined {
  const trimmed = (text ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/** What still stops a submission, in form order. */
export function shiftEvaluationProblems(form: ShiftEvaluationFormSnapshot, draft: ShiftEvaluationDraft): string[] {
  const problems: string[] = [];
  form.header_fields.forEach((field) => {
    if (field.required && !(draft.header_values[field.key ?? ''] ?? '').trim()) {
      problems.push(`Answer "${field.label}".`);
    }
  });
  form.statistics.forEach((stat) => {
    if (parseCount(draft.statistics[stat]) === undefined) {
      problems.push(`Enter the ${SHIFT_EVALUATION_STATISTIC_LABELS[stat].toLowerCase()}.`);
    }
  });
  const calls = parseCount(draft.statistics.calls);
  const outcomes = (parseCount(draft.statistics.transports) ?? 0) + (parseCount(draft.statistics.refusals) ?? 0);
  if (calls !== undefined && outcomes > calls) {
    problems.push('Transports and refusals together cannot exceed the number of calls.');
  }
  shiftEvaluationItems(form).forEach(({ item }) => {
    const answer = draft.responses[item.key];
    if (!answer || (answer.rating == null && !answer.not_applicable)) {
      problems.push(`Rate "${item.label}".`);
      return;
    }
    if (commentRequired(form, item, answer) && !(answer.comment ?? '').trim()) {
      problems.push(`Add a comment for "${item.label}".`);
    }
  });
  return problems;
}

/** Requirement types credited by submitted shift evaluations, and the field each one's target lives in. */
export const EVALUATION_REQUIREMENT_TARGETS = {
  evaluated_shifts: 'required_shifts',
  transports: 'required_transports',
  refusals: 'required_refusals',
} as const;
export type EvaluationRequirementType = keyof typeof EVALUATION_REQUIREMENT_TARGETS;

export function isEvaluationRequirementType(type: string | undefined | null): type is EvaluationRequirementType {
  return type != null && Object.prototype.hasOwnProperty.call(EVALUATION_REQUIREMENT_TARGETS, type);
}

/** "3.3 / 4": an evaluation average against its own form's top rating. */
export const formatEvaluationAverage = (average: ShiftEvaluationAverage): string =>
  `${average.average} / ${average.scale_max}`;

/** "EMT Shift Evaluation · 5 evaluations" */
export const evaluationAverageLabel = (average: ShiftEvaluationAverage): string =>
  `${average.form_name} · ${average.evaluations} ${average.evaluations === 1 ? 'evaluation' : 'evaluations'}`;
