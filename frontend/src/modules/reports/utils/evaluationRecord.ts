/**
 * Presentation helpers for evaluations. What an evaluation may show, and who
 * may act on it, is decided by the server and arrives as `viewer`; these only
 * format and arrange what it sent.
 */
import { formatCalendarDate, formatNumber } from '../../../utils/dateFormatting';
import type {
  DataEntry,
  EvaluationDataSource,
  EvaluationPartKind,
  GradeResult,
  ItemAnswer,
  PartContent,
  TemplateDefinition,
  TemplateItem,
} from '../types/evaluations';

/** A measured figure as text, in its source's unit. */
export function formatFigure(entry: DataEntry | undefined, unit: EvaluationDataSource['unit']): string {
  if (!entry) return 'Not measured';
  if (!entry.available) return entry.note || 'Not available';
  const { value } = entry;
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    return value
      .map((v) => (v.expires_on ? `${v.label} (expires ${formatCalendarDate(v.expires_on)})` : v.label))
      .join(', ');
  }
  if (typeof value !== 'number') return 'Not available';
  switch (unit) {
    case 'percent':
      return `${formatNumber(value, { maximumFractionDigits: 1 })}%`;
    case 'hours':
      return `${formatNumber(value, { maximumFractionDigits: 2 })} h`;
    case 'rating':
      return `${formatNumber(value, { maximumFractionDigits: 1 })} / 5`;
    default:
      return formatNumber(value);
  }
}

/** The items a part answers: a self-evaluation answers only the items its
 * template includes in it. */
export function partItems(definition: TemplateDefinition, kind: EvaluationPartKind): TemplateItem[] {
  return definition.sections.flatMap((section) =>
    section.items.filter((item) => kind !== 'self_evaluation' || item.include_in_self_evaluation)
  );
}

export const emptyContent = (): PartContent => ({ answers: {} });

/** A copy of `content` with one item's answer merged in. */
export function withAnswer(content: PartContent, key: string, patch: Partial<ItemAnswer>): PartContent {
  const current = content.answers[key] ?? {};
  return { ...content, answers: { ...content.answers, [key]: { ...current, ...patch } } };
}

/** Whether the evaluator must justify this item's rating: a suggested score
 * exists and the rating given differs from it. The server enforces the same
 * rule on submit; the form only shows the field when it will be asked for. */
export function needsJustification(answer: ItemAnswer | undefined, suggested: number | undefined): boolean {
  return (
    suggested !== undefined && answer?.rating !== undefined && answer.rating !== null && answer.rating !== suggested
  );
}

/**
 * A calculated grade in words, as the PDF prints it: "3.6 of 5 — Exceeds
 * expectations". The score and grade are the server's; this only words them.
 */
export function describeCalculatedGrade(result: GradeResult | undefined | null): string {
  if (!result || result.score === null) return 'Not graded yet';
  const score = formatNumber(result.score, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${score} of 5 — ${result.calculated_label ?? ''}`;
}
