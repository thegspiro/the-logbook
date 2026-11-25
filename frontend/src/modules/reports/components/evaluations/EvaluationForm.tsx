/**
 * An evaluation part — the evaluator's or the member's self-evaluation —
 * rendered from its template, editable or read-only.
 *
 * Each item shows its figure and, where the template scores it, the rating
 * the figure suggests. Fields appear only when they apply: an example where
 * the chosen level requires one, a justification where the evaluator departs
 * from the suggested rating. Whether the part is complete is decided by the
 * server on submit, which lists what is missing.
 *
 * A goal-review item rates each goal the member's previous review set, from
 * the copy taken when this evaluation was drafted (`goalsUnderReview`).
 */
import React from 'react';
import type {
  DataEntry,
  EvaluationDataSource,
  EvaluationPartKind,
  GoalEntry,
  GoalRating,
  GoalResult,
  GoalsUnderReview,
  Grades,
  ItemAnswer,
  PartContent,
  ScaleLevel,
  TemplateDefinition,
  TemplateItem,
} from '../../types/evaluations';
import { GOAL_RESULT_LABELS } from '../../types/evaluations';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import {
  MAX_ANSWER_TEXT,
  figureDetail,
  formatFigure,
  needsJustification,
  withAnswer,
} from '../../utils/evaluationRecord';
import { GradePanel } from './GradePanel';

interface EvaluationFormProps {
  kind: EvaluationPartKind;
  definition: TemplateDefinition;
  content: PartContent;
  onChange?: ((content: PartContent) => void) | undefined;
  readOnly: boolean;
  data: Record<string, DataEntry> | null;
  sources: EvaluationDataSource[];
  suggested: Record<string, number>;
  overallLevels: ScaleLevel[];
  /** Evaluator items the calibrator flagged to revisit. */
  flagged?: string[] | undefined;
  /** The server's section and overall grades, for a form graded by section. */
  grades?: Grades | null | undefined;
  /** The last recalculation failed; the grades shown may be out of date. */
  gradesError?: boolean | undefined;
  /** The previous review's goals as copied into this evaluation, for a goal-review item. */
  goalsUnderReview?: GoalsUnderReview | null | undefined;
}

const GOAL_RESULTS = Object.keys(GOAL_RESULT_LABELS) as GoalResult[];

/** As many goals as the server keeps on one Goals item (`MAX_GOALS_PER_ITEM`). */
const MAX_GOALS = 20;

const MEETS_LEVELS: ScaleLevel[] = [
  { value: 1, label: 'Meets', anchor: null },
  { value: 0, label: 'Does not meet', anchor: null },
];

function levelsFor(item: TemplateItem): ScaleLevel[] {
  return item.tool === 'meets' ? MEETS_LEVELS : item.levels;
}

const ReadOnlyText: React.FC<{ label: string; value: string | null | undefined }> = ({ label, value }) =>
  value ? (
    <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">
      <span className="text-theme-text-secondary">{label}: </span>
      {value}
    </p>
  ) : null;

export const EvaluationForm: React.FC<EvaluationFormProps> = ({
  kind,
  definition,
  content,
  onChange,
  readOnly,
  data,
  sources,
  suggested,
  overallLevels,
  flagged = [],
  grades = null,
  gradesError = false,
  goalsUnderReview = null,
}) => {
  const evaluator = kind === 'evaluator';
  const flaggedKeys = new Set(evaluator ? flagged : []);
  const sourceByKey = new Map(sources.map((s) => [s.key, s]));
  const update = (key: string, patch: Partial<ItemAnswer>) => {
    if (onChange) onChange(withAnswer(content, key, patch));
  };
  const goals = goalsUnderReview?.goals ?? [];
  // Only the goals copied into this evaluation are kept: a rating for a goal
  // no longer in the copy (the figures were refreshed after last year's
  // review was amended) would be refused by the server on save.
  const rateGoal = (itemKey: string, goalKey: string, patch: Partial<GoalRating>) => {
    const current = content.answers[itemKey]?.goal_ratings ?? {};
    const next: Record<string, GoalRating> = {};
    for (const goal of goals) {
      const existing = current[goal.key];
      if (goal.key === goalKey) next[goal.key] = { ...existing, ...patch };
      else if (existing) next[goal.key] = existing;
    }
    update(itemKey, { goal_ratings: next });
  };

  // A Goals answer saved before goals were a list holds them as one block of
  // text; it is edited as the list's first goal, which is how a save stores it.
  const goalsOf = (answer: ItemAnswer | undefined): GoalEntry[] =>
    answer?.goals && answer.goals.length > 0
      ? answer.goals
      : answer?.text
        ? [{ id: 'goal-1', text: answer.text, target_date: null }]
        : [];

  const setGoals = (itemKey: string, goals: GoalEntry[]) => update(itemKey, { goals, text: null });

  const renderGoals = (item: TemplateItem, answer: ItemAnswer | undefined, id: string) => {
    const goals = goalsOf(answer);
    if (readOnly) {
      return goals.length === 0 ? (
        <p className="text-theme-text-secondary mt-2 text-sm">No goals set.</p>
      ) : (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          {goals.map((goal) => (
            <li key={goal.id} className="text-theme-text-primary">
              <span className="whitespace-pre-wrap">{goal.text}</span>
              {goal.target_date && (
                <span className="text-theme-text-secondary"> (by {formatCalendarDate(goal.target_date)})</span>
              )}
            </li>
          ))}
        </ol>
      );
    }
    const change = (index: number, patch: Partial<GoalEntry>) =>
      setGoals(
        item.key,
        goals.map((goal, i) => (i === index ? { ...goal, ...patch } : goal))
      );
    const nextId = () => {
      const taken = new Set(goals.map((goal) => goal.id));
      let n = goals.length + 1;
      while (taken.has(`goal-${n}`)) n += 1;
      return `goal-${n}`;
    };
    return (
      <div className="mt-2 space-y-3">
        {goals.map((goal, index) => (
          <div key={goal.id} className="card-secondary space-y-2 p-3">
            <div>
              <label htmlFor={`${id}-${goal.id}-text`} className="form-label">
                Goal {index + 1}
              </label>
              <textarea
                maxLength={MAX_ANSWER_TEXT}
                id={`${id}-${goal.id}-text`}
                className="form-input"
                value={goal.text}
                onChange={(e) => change(index, { text: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor={`${id}-${goal.id}-date`} className="form-label">
                  Target date for goal {index + 1} <span className="text-theme-text-muted font-normal">(optional)</span>
                </label>
                <input
                  id={`${id}-${goal.id}-date`}
                  type="date"
                  className="form-input"
                  value={goal.target_date ?? ''}
                  onChange={(e) => change(index, { target_date: e.target.value || null })}
                />
              </div>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() =>
                  setGoals(
                    item.key,
                    goals.filter((_, i) => i !== index)
                  )
                }
              >
                Remove goal {index + 1}
              </button>
            </div>
          </div>
        ))}
        {goals.length < MAX_GOALS && (
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setGoals(item.key, [...goals, { id: nextId(), text: '', target_date: null }])}
          >
            Add a goal
          </button>
        )}
      </div>
    );
  };

  const renderGoalReview = (item: TemplateItem, answer: ItemAnswer | undefined, id: string) => {
    if (goals.length === 0) {
      return (
        <p className="text-theme-text-secondary mt-2 text-sm">
          The member&apos;s previous review on this form set no goals, so there is nothing to rate here.
        </p>
      );
    }
    const period =
      goalsUnderReview?.period_name ??
      `${goalsUnderReview?.period_start ?? ''} – ${goalsUnderReview?.period_end ?? ''}`;
    return (
      <div className="mt-2 space-y-3">
        <p className="text-theme-text-secondary text-sm">Goals set in the review for {period}.</p>
        {goals.map((goal) => {
          const rating = answer?.goal_ratings?.[goal.key];
          const result = rating?.result ?? null;
          return (
            <div key={goal.key} className="card-secondary p-3">
              <p className="text-theme-text-secondary text-xs font-medium tracking-wide uppercase">{goal.label}</p>
              <p className="text-theme-text-primary mt-1 text-sm whitespace-pre-wrap">{goal.text}</p>
              {goal.target_date && (
                <p className="text-theme-text-secondary mt-1 text-xs">Target: {formatCalendarDate(goal.target_date)}</p>
              )}
              {readOnly ? (
                <>
                  <p className="text-theme-text-primary mt-2 text-sm font-medium">
                    {result ? GOAL_RESULT_LABELS[result] : 'Not rated'}
                  </p>
                  <ReadOnlyText label="Comment" value={rating?.comment} />
                </>
              ) : (
                <>
                  <div
                    role="radiogroup"
                    aria-label={`${goal.label} result`}
                    className="mt-2 flex flex-wrap gap-x-4 gap-y-1"
                  >
                    {GOAL_RESULTS.map((value) => (
                      <label key={value} className="touch:min-h-11 flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`${id}-${goal.key}-result`}
                          checked={result === value}
                          onChange={() => rateGoal(item.key, goal.key, { result: value })}
                        />
                        {GOAL_RESULT_LABELS[value]}
                      </label>
                    ))}
                  </div>
                  <label htmlFor={`${id}-${goal.key}-comment`} className="form-label mt-2">
                    Comment on {goal.label}
                  </label>
                  <textarea
                    maxLength={MAX_ANSWER_TEXT}
                    id={`${id}-${goal.key}-comment`}
                    className="form-input"
                    value={rating?.comment ?? ''}
                    onChange={(e) => rateGoal(item.key, goal.key, { comment: e.target.value })}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderItem = (item: TemplateItem) => {
    const answer = content.answers[item.key];
    const id = `${kind}-${item.key}`;
    const levels = levelsFor(item);
    const scored = item.tool === 'labeled_scale' || item.tool === 'numeric_scale' || item.tool === 'meets';
    // A Goals item is a list of goals, so it is written in renderGoals, not in
    // the one text box a narrative item gets.
    const written = item.tool === 'narrative';
    const source = item.data_block ? sourceByKey.get(item.data_block.source) : undefined;
    const figure = item.data_block && data ? data[item.data_block.source] : undefined;
    const detail = item.data_block ? figureDetail(item.data_block.source, figure) : null;
    const suggestion = evaluator ? suggested[item.key] : undefined;
    const rating = answer?.rating ?? null;
    const exampleNeeded = rating !== null && item.require_example_for.includes(rating);
    const justify = evaluator && needsJustification(answer, suggestion);
    const ratingLabel = levels.find((l) => l.value === rating)?.label;

    return (
      <li key={item.key} className="border-theme-surface-border border-t pt-4 first:border-t-0 first:pt-0">
        <fieldset disabled={readOnly}>
          <legend className="text-theme-text-primary font-medium">
            {item.label}
            {flaggedKeys.has(item.key) && (
              <span className="badge ml-2 bg-amber-500/15 align-middle text-amber-900 dark:text-amber-200">
                Flagged at calibration
              </span>
            )}
          </legend>
          {item.help_text && <p className="text-theme-text-secondary mt-1 text-sm">{item.help_text}</p>}
          {source && (
            <p className="text-theme-text-secondary mt-1 text-sm">
              {source.label}:{' '}
              <span className="text-theme-text-primary font-medium">{formatFigure(figure, source.unit)}</span>
              {detail && <span className="text-theme-text-secondary"> ({detail})</span>}
              {suggestion !== undefined && (
                <span className="badge ml-2 bg-blue-500/15 text-blue-900 dark:text-blue-200">
                  Suggested: {levels.find((l) => l.value === suggestion)?.label ?? suggestion}
                </span>
              )}
            </p>
          )}

          {scored &&
            (readOnly ? (
              <p className="text-theme-text-primary mt-2 text-sm font-medium">
                {answer?.na ? 'Not applicable' : (ratingLabel ?? 'Not rated')}
              </p>
            ) : (
              <div role="radiogroup" aria-label={`${item.label} rating`} className="mt-2 grid gap-2">
                {levels.map((level) => (
                  <label
                    key={level.value}
                    className="card-secondary touch:min-h-11 flex cursor-pointer items-start gap-2 p-2 text-sm"
                  >
                    <input
                      type="radio"
                      className="mt-1"
                      name={`${id}-rating`}
                      checked={rating === level.value && !answer?.na}
                      onChange={() => update(item.key, { rating: level.value, na: false })}
                    />
                    <span>
                      <span className="text-theme-text-primary font-medium">{level.label}</span>
                      {level.anchor && <span className="text-theme-text-secondary block">{level.anchor}</span>}
                    </span>
                  </label>
                ))}
                {item.allow_na && (
                  <label className="touch:min-h-11 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={Boolean(answer?.na)}
                      onChange={(e) => update(item.key, { na: e.target.checked, rating: null })}
                    />
                    Not applicable
                  </label>
                )}
              </div>
            ))}

          {item.tool === 'checklist' && (
            <div className="mt-2 grid gap-1">
              {item.checklist_options.map((option) => {
                const checked = answer?.checked?.includes(option) ?? false;
                return (
                  <label key={option} className="touch:min-h-11 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = answer?.checked ?? [];
                        update(item.key, {
                          checked: e.target.checked ? [...current, option] : current.filter((o) => o !== option),
                        });
                      }}
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}

          {item.tool === 'goal_review' && renderGoalReview(item, answer, id)}

          {item.tool === 'goals' && renderGoals(item, answer, id)}

          {written &&
            (readOnly ? (
              <ReadOnlyText label="Answer" value={answer?.text} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-text`} className="sr-only">
                  {item.label}
                </label>
                <textarea
                  maxLength={MAX_ANSWER_TEXT}
                  id={`${id}-text`}
                  className="form-input min-h-24"
                  value={answer?.text ?? ''}
                  onChange={(e) => update(item.key, { text: e.target.value })}
                />
              </div>
            ))}

          {!written &&
            item.tool !== 'goal_review' &&
            item.comment !== 'none' &&
            (readOnly ? (
              <ReadOnlyText label="Comment" value={answer?.comment} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-comment`} className="form-label">
                  Comment{item.comment === 'required' ? ' (required)' : ''}
                </label>
                <textarea
                  maxLength={MAX_ANSWER_TEXT}
                  id={`${id}-comment`}
                  className="form-input"
                  value={answer?.comment ?? ''}
                  onChange={(e) => update(item.key, { comment: e.target.value })}
                />
              </div>
            ))}

          {exampleNeeded &&
            (readOnly ? (
              <ReadOnlyText label="Example" value={answer?.example} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-example`} className="form-label">
                  Describe a specific example (required at this level)
                </label>
                <textarea
                  maxLength={MAX_ANSWER_TEXT}
                  id={`${id}-example`}
                  className="form-input"
                  value={answer?.example ?? ''}
                  onChange={(e) => update(item.key, { example: e.target.value })}
                />
              </div>
            ))}

          {(justify || (readOnly && answer?.justification)) &&
            (readOnly ? (
              <ReadOnlyText label="Why the rating differs from the figures" value={answer?.justification} />
            ) : (
              <div className="mt-2">
                <label htmlFor={`${id}-justification`} className="form-label">
                  Why does your rating differ from the suggested one? (required)
                </label>
                <textarea
                  maxLength={MAX_ANSWER_TEXT}
                  id={`${id}-justification`}
                  className="form-input"
                  value={answer?.justification ?? ''}
                  onChange={(e) => update(item.key, { justification: e.target.value })}
                />
              </div>
            ))}
        </fieldset>
      </li>
    );
  };

  const sections = definition.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => kind !== 'self_evaluation' || item.include_in_self_evaluation),
    }))
    .filter((section) => section.items.length > 0);
  const overallLabel = overallLevels.find((l) => l.value === content.overall_rating)?.label;
  // Only the evaluator grades; a self-evaluation shows the items alone.
  const graded = evaluator && definition.overall_mode === 'sectioned';
  const sectionGrade = (key: string) => grades?.sections.find((g) => g.key === key);
  const setSectionGrade = (key: string, level: number | null, reason: string) => {
    const next = { ...(content.section_grades ?? {}) };
    if (level === null) delete next[key];
    else next[key] = { level, reason };
    onChange?.({ ...content, section_grades: next });
  };

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`${kind}-${section.key}-title`} className="card p-4 sm:p-6">
          <h3 id={`${kind}-${section.key}-title`} className="text-theme-text-primary text-lg font-semibold">
            {section.title}
          </h3>
          {section.description && <p className="text-theme-text-secondary mt-1 text-sm">{section.description}</p>}
          <ul className="mt-4 space-y-4">{section.items.map(renderItem)}</ul>
          {graded && sectionGrade(section.key) && (
            <GradePanel
              id={`${kind}-${section.key}`}
              title="Section grade"
              result={sectionGrade(section.key)}
              levels={overallLevels}
              overrideLevel={content.section_grades?.[section.key]?.level ?? null}
              reason={content.section_grades?.[section.key]?.reason ?? ''}
              readOnly={readOnly}
              onChange={(level, reason) => setSectionGrade(section.key, level, reason)}
            />
          )}
        </section>
      ))}

      {graded && (
        <section aria-labelledby={`${kind}-overall-grade`} className="card p-4 sm:p-6">
          <h3 id={`${kind}-overall-grade`} className="text-theme-text-primary text-lg font-semibold">
            Overall grade
          </h3>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Each section&apos;s grade counts by its weight. Grades update as you rate and are recalculated when the
            evaluation is saved.
          </p>
          {gradesError && (
            <p className="text-theme-alert-warning-text mt-2 text-sm" role="status">
              The grades could not be recalculated just now, so they may not reflect your latest ratings.
            </p>
          )}
          <GradePanel
            id={`${kind}-overall`}
            title="Overall grade"
            result={grades?.overall}
            levels={overallLevels}
            overrideLevel={content.overall_rating ?? null}
            reason={content.overall_override_reason ?? ''}
            readOnly={readOnly}
            onChange={(level, reason) =>
              onChange?.({ ...content, overall_rating: level, overall_override_reason: level === null ? null : reason })
            }
          />
        </section>
      )}

      {evaluator && definition.overall_mode === 'evaluator' && (
        <section aria-labelledby={`${kind}-overall`} className="card p-4 sm:p-6">
          <h3 id={`${kind}-overall`} className="text-theme-text-primary text-lg font-semibold">
            Overall rating
          </h3>
          {readOnly ? (
            <p className="text-theme-text-primary mt-2 text-sm font-medium">{overallLabel ?? 'Not rated'}</p>
          ) : (
            <>
              <label htmlFor={`${kind}-overall-rating`} className="sr-only">
                Overall rating
              </label>
              <select
                id={`${kind}-overall-rating`}
                className="form-input mt-2"
                value={content.overall_rating ?? ''}
                onChange={(e) =>
                  onChange?.({ ...content, overall_rating: e.target.value ? Number(e.target.value) : null })
                }
              >
                <option value="">Choose…</option>
                {overallLevels.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </section>
      )}

      <section aria-labelledby={`${kind}-summary`} className="card p-4 sm:p-6">
        <h3 id={`${kind}-summary`} className="text-theme-text-primary text-lg font-semibold">
          {evaluator ? 'Summary' : 'Anything else'}
        </h3>
        {readOnly ? (
          <p className="text-theme-text-primary mt-2 text-sm whitespace-pre-wrap">
            {content.overall_comment || 'Nothing added.'}
          </p>
        ) : (
          <>
            <label htmlFor={`${kind}-overall-comment`} className="sr-only">
              {evaluator ? 'Summary' : 'Anything else'}
            </label>
            <textarea
              maxLength={MAX_ANSWER_TEXT}
              id={`${kind}-overall-comment`}
              className="form-input mt-2 min-h-24"
              value={content.overall_comment ?? ''}
              onChange={(e) => onChange?.({ ...content, overall_comment: e.target.value })}
            />
          </>
        )}
      </section>
    </div>
  );
};
