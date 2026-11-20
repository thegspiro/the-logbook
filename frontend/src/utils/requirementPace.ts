/**
 * The average hours a month an hours requirement shows as its headline figure.
 *
 * The server works it out once (`training_compliance.monthly_pace`) and sends
 * it on both My Training and the compliance matrix, so these helpers only
 * print it. They never derive it (CLAUDE.md pitfall 29). The two screens use
 * the same wording, so an officer comparing them reads the same figure.
 *
 * The average is shown in addition to the total, never as the grade: whether
 * the requirement is met is still decided on the total.
 */

export interface MonthlyPace {
  /** Hours a month in the months nothing excused. */
  average: number;
  /** The department's monthly pace, or null when the requirement sets none. */
  needed: number | null;
}

/**
 * The pace to show, or null when the server sent no average. That covers a
 * requirement that isn't graded in hours, a month range wholly excused, and
 * an older server that does not send the field.
 */
export const monthlyPaceOf = (
  average: number | null | undefined,
  needed: number | null | undefined
): MonthlyPace | null => (average == null ? null : { average, needed: needed ?? null });

/** One decimal place, with a trailing zero dropped: 6.9, 6. */
export const perMonth = (n: number): string => String(Math.round(n * 10) / 10);

/** "6.9/6 hrs/mo avg", or "6.9 hrs/mo avg" when no pace is set. */
export const paceLabel = (pace: MonthlyPace): string =>
  pace.needed != null
    ? `${perMonth(pace.average)}/${perMonth(pace.needed)} hrs/mo avg`
    : `${perMonth(pace.average)} hrs/mo avg`;

/** What a screen reader announces in place of the abbreviated label. */
export const paceSpoken = (pace: MonthlyPace): string =>
  pace.needed != null
    ? `Averaging ${perMonth(pace.average)} hours a month of ${perMonth(pace.needed)} needed`
    : `Averaging ${perMonth(pace.average)} hours a month`;
