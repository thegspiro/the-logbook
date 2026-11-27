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
  EvaluationSummary,
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

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const count = (n: number, one: string, many: string): string => `${formatNumber(n)} ${n === 1 ? one : many}`;

/**
 * The counts behind a measured figure, in words, or null: 75% of four
 * meetings is not 75% of twenty, and a waiver count says nothing of what
 * became of the requests. Read from the extras each source stores beside its
 * value, so an older snapshot without them shows no detail. The PDF words the
 * same details in `figure_detail` (backend
 * `services/evaluation_document_service.py`); change both together.
 */
export function figureDetail(key: string, entry: DataEntry | undefined): string | null {
  if (!entry?.available) return null;
  if (key === 'training.requirements_met_pct') {
    const met = num(entry.met);
    const total = num(entry.total);
    if (met !== undefined && total !== undefined) {
      return `${formatNumber(met)} of ${count(total, 'requirement', 'requirements')} met`;
    }
  }
  if (key === 'training.session_attendance_pct') {
    const attended = num(entry.attended);
    const held = num(entry.held);
    const excused = num(entry.excused) ?? 0;
    if (attended !== undefined && held !== undefined) {
      let text = `${formatNumber(attended)} of ${count(held - excused, 'session', 'sessions')} attended`;
      if (excused) text += ` (${formatNumber(excused)} excused)`;
      if (typeof entry.requirement === 'string' && entry.requirement) {
        text += `; ${entry.requirement} requires ${formatNumber(num(entry.required_pct) ?? 0)}%`;
      }
      return text;
    }
  }
  if (key === 'events.meeting_attendance_pct') {
    const attended = num(entry.attended);
    const held = num(entry.held);
    if (attended !== undefined && held !== undefined) {
      return `${formatNumber(attended)} of ${count(held, 'meeting', 'meetings')} attended`;
    }
  }
  if (key === 'calls.response_pct') {
    const responses = num(entry.responses);
    const calls = num(entry.department_calls);
    if (responses !== undefined && calls !== undefined) {
      let text = `${count(responses, 'response', 'responses')} to ${count(calls, 'department call', 'department calls')}`;
      if (entry.capped === true) {
        text += "; shown as 100% because shift call credit exceeds the department's call log";
      }
      return text;
    }
  }
  const madeOf = typeof entry.breakdown === 'string' && entry.breakdown ? entry.breakdown : null;
  let leftOut: string | null = null;
  if (key === 'shifts.hours') {
    const external = num(entry.external_hours);
    if (external)
      leftOut = `Not included: ${formatNumber(external, { maximumFractionDigits: 2 })} h for other agencies`;
  }
  if (key === 'shifts.count') {
    const external = num(entry.external_shifts);
    if (external) leftOut = `Not included: ${count(external, 'shift', 'shifts')} for other agencies`;
  }
  return [madeOf, leftOut].filter(Boolean).join('. ') || null;
}

/** The items a part answers: a self-evaluation answers only the items its
 * template includes in it. */
export function partItems(definition: TemplateDefinition, kind: EvaluationPartKind): TemplateItem[] {
  return definition.sections.flatMap((section) =>
    section.items.filter((item) => kind !== 'self_evaluation' || item.include_in_self_evaluation)
  );
}

export const emptyContent = (): PartContent => ({ answers: {} });

/** The server's cap on every written answer, comment and reason in a part, and
 * on the member's response (`MAX_ANSWER_TEXT` in schemas/evaluation.py). Held in
 * the box so an over-long entry is never typed only to be refused on save. */
export const MAX_ANSWER_TEXT = 5000;

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

/** The five overall grades, lowest first, to order a period's counts. */
const GRADE_ORDER = [
  'Unsatisfactory',
  'Needs improvement',
  'Meets expectations',
  'Exceeds expectations',
  'Outstanding',
];

/** How many of `rows` stand at each overall grade, in grade order, then any
 * other result (a weighted percentage) under its own words. Counts what the
 * server sent; it decides each grade. */
export function gradeCounts(rows: EvaluationSummary[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.overall_grade) counts.set(row.overall_grade, (counts.get(row.overall_grade) ?? 0) + 1);
  }
  const rank = (label: string) => {
    const i = GRADE_ORDER.indexOf(label);
    return i === -1 ? GRADE_ORDER.length : i;
  };
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

/** Two ratings this far apart, in levels of the item's scale, are flagged as worth discussing. */
export const SELF_COMPARISON_GAP = 2;

export interface SelfComparisonRow {
  key: string;
  label: string;
  self: string;
  evaluator: string;
  /** The two ratings are far enough apart to talk about: two levels or more on a scale, or opposite answers on meets / does not meet. */
  differs: boolean;
}

function ratingLabel(item: TemplateItem, answer: ItemAnswer | undefined): string {
  if (answer?.na) return 'Not applicable';
  if (answer?.rating === undefined || answer.rating === null) return 'Not rated';
  if (item.tool === 'meets') return answer.rating === 1 ? 'Meets' : 'Does not meet';
  return item.levels.find((level) => level.value === answer.rating)?.label ?? String(answer.rating);
}

/**
 * The rated items the member answered in their self-evaluation, beside the
 * evaluator's rating of each. Both parts are what the server already sent this
 * viewer; nothing here is read that the two forms do not show on their own.
 */
export function compareSelfEvaluation(
  definition: TemplateDefinition,
  self: PartContent,
  evaluator: PartContent
): SelfComparisonRow[] {
  return partItems(definition, 'self_evaluation')
    .filter((item) => item.tool === 'labeled_scale' || item.tool === 'numeric_scale' || item.tool === 'meets')
    .map((item) => {
      const mine = self.answers[item.key];
      const theirs = evaluator.answers[item.key];
      const a = mine?.na ? null : (mine?.rating ?? null);
      const b = theirs?.na ? null : (theirs?.rating ?? null);
      const differs =
        a !== null && b !== null && (item.tool === 'meets' ? a !== b : Math.abs(a - b) >= SELF_COMPARISON_GAP);
      return {
        key: item.key,
        label: item.label,
        self: ratingLabel(item, mine),
        evaluator: ratingLabel(item, theirs),
        differs,
      };
    });
}
