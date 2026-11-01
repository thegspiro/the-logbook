/**
 * The fillable part of a shift evaluation: header answers, shift statistics,
 * a rating per item and the comments the form asks for.
 *
 * Controlled: the evaluation page owns the draft and saves it. Ratings are
 * a row of buttons rather than a select because an officer fills these out
 * on a phone in the bay, and a 44px target per rating is one tap each.
 */

import React, { useState } from 'react';
import type {
  ShiftEvaluationFormSnapshot,
  ShiftEvaluationItemAnswer,
  ShiftEvaluationStatistic,
} from '../../types/training';
import {
  SHIFT_EVALUATION_STATISTIC_LABELS,
  commentRequired,
  type ShiftEvaluationDraft,
} from '../../utils/shiftEvaluations';

interface Props {
  form: ShiftEvaluationFormSnapshot;
  draft: ShiftEvaluationDraft;
  onChange: (draft: ShiftEvaluationDraft) => void;
  /** Mark required-but-empty comments once the officer has tried to submit. */
  showErrors: boolean;
}

const ratingButtonClass = (selected: boolean, low: boolean, na: boolean) =>
  `touch:min-h-11 min-h-9 min-w-11 flex-1 border-l border-theme-surface-border px-2 text-sm font-semibold first:border-l-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
    selected
      ? na
        ? 'bg-slate-700 text-white'
        : low
          ? 'bg-amber-800 text-white'
          : 'bg-red-800 text-white'
      : 'bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover'
  }`;

export const ShiftEvaluationFields: React.FC<Props> = ({ form, draft, onChange, showErrors }) => {
  const threshold = form.comment_required_at_or_below;
  // Optional comment boxes the officer has opened; a box that already holds
  // text, or that the form requires, is always shown.
  const [openComments, setOpenComments] = useState<Set<string>>(() => new Set());

  const setAnswer = (key: string, patch: Partial<ShiftEvaluationItemAnswer>) => {
    const current = draft.responses[key] ?? { rating: null, not_applicable: false, comment: null };
    onChange({ ...draft, responses: { ...draft.responses, [key]: { ...current, ...patch } } });
  };

  const setStatistic = (stat: ShiftEvaluationStatistic, value: string) =>
    onChange({ ...draft, statistics: { ...draft.statistics, [stat]: value } });

  return (
    <div className="space-y-4">
      {form.header_fields.length > 0 && (
        <section className="card space-y-3 p-4" aria-labelledby="se-header-heading">
          <h2 id="se-header-heading" className="text-theme-text-primary font-semibold">
            Shift details
          </h2>
          {form.header_fields.map((field) => {
            const key = field.key ?? '';
            const value = draft.header_values[key] ?? '';
            const setValue = (next: string) =>
              onChange({ ...draft, header_values: { ...draft.header_values, [key]: next } });
            return field.type === 'choice' ? (
              <fieldset key={key}>
                <legend className="form-label">
                  {field.label}
                  {field.required && <span className="text-red-700"> *</span>}
                </legend>
                <div className="flex flex-wrap gap-2">
                  {field.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={value === option}
                      onClick={() => setValue(value === option ? '' : option)}
                      className={`touch:min-h-11 min-h-9 min-w-11 rounded-full border px-4 text-sm font-semibold ${
                        value === option
                          ? 'border-red-800 bg-red-800 text-white'
                          : 'border-theme-surface-border text-theme-text-secondary'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div key={key}>
                <label htmlFor={`se-header-${key}`} className="form-label">
                  {field.label}
                  {field.required && <span className="text-red-700"> *</span>}
                </label>
                <input
                  id={`se-header-${key}`}
                  className="form-input"
                  value={value}
                  maxLength={200}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
            );
          })}
        </section>
      )}

      {form.statistics.length > 0 && (
        <section className="card space-y-3 p-4" aria-labelledby="se-stats-heading">
          <h2 id="se-stats-heading" className="text-theme-text-primary font-semibold">
            Shift statistics
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {form.statistics.map((stat) => (
              <div key={stat}>
                <label htmlFor={`se-stat-${stat}`} className="form-label">
                  {SHIFT_EVALUATION_STATISTIC_LABELS[stat]}
                </label>
                <input
                  id={`se-stat-${stat}`}
                  className="form-input"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={draft.statistics[stat] ?? ''}
                  onChange={(e) => setStatistic(stat, e.target.value.replace(/[^0-9]/g, ''))}
                />
              </div>
            ))}
          </div>
          {form.statistics.includes('calls') && (
            <p className="text-theme-text-muted text-xs">Transports and refusals cannot exceed the number of calls.</p>
          )}
        </section>
      )}

      <div className="alert-info text-theme-alert-info-text text-sm">
        <p className="font-semibold">Rating scale</p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          {form.scale.map((level) => (
            <span key={level.value}>
              <strong>{level.value}</strong> {level.label}
            </span>
          ))}
          {form.allow_not_applicable && (
            <span>
              <strong>N/A</strong> {form.not_applicable_label}
            </span>
          )}
        </p>
      </div>

      {form.sections.map((section) => (
        <section key={section.key} className="card p-4" aria-labelledby={`se-section-${section.key}`}>
          <h2 id={`se-section-${section.key}`} className="text-theme-text-primary mb-2 font-semibold">
            {section.title}
          </h2>
          <ol className="divide-theme-surface-border divide-y">
            {section.items.map((item, index) => {
              const key = item.key ?? '';
              const answer = draft.responses[key];
              const needsComment = commentRequired(form, item, answer);
              const missingComment = showErrors && needsComment && !(answer?.comment ?? '').trim();
              const groupLabel = `${item.label} rating`;
              return (
                <li key={key} className="py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="min-w-[14rem] flex-1">
                      <p className="text-theme-text-primary font-medium">
                        {index + 1}. {item.label}
                      </p>
                      {item.description && <p className="text-theme-text-muted text-xs">{item.description}</p>}
                    </div>
                    <div
                      role="radiogroup"
                      aria-label={groupLabel}
                      className="border-theme-surface-border flex w-full overflow-hidden rounded-lg border sm:w-auto"
                    >
                      {form.scale.map((level) => {
                        const selected = answer?.rating === level.value;
                        return (
                          <button
                            key={level.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={`${level.value} – ${level.label}`}
                            title={level.label}
                            onClick={() =>
                              setAnswer(key, { rating: selected ? null : level.value, not_applicable: false })
                            }
                            className={ratingButtonClass(
                              selected,
                              threshold != null && level.value <= threshold,
                              false
                            )}
                          >
                            {level.value}
                          </button>
                        );
                      })}
                      {form.allow_not_applicable && (
                        <button
                          type="button"
                          role="radio"
                          aria-checked={Boolean(answer?.not_applicable)}
                          aria-label={`N/A – ${form.not_applicable_label}`}
                          title={form.not_applicable_label}
                          onClick={() => setAnswer(key, { rating: null, not_applicable: !answer?.not_applicable })}
                          className={ratingButtonClass(Boolean(answer?.not_applicable), false, true)}
                        >
                          N/A
                        </button>
                      )}
                    </div>
                  </div>
                  {(needsComment || (answer?.comment ?? '') !== '' || openComments.has(key)) && (
                    <div className="mt-2">
                      <label htmlFor={`se-comment-${key}`} className="form-label">
                        Comment{needsComment && <span className="text-red-700"> *</span>}
                        {needsComment && !item.comment_always_required && threshold != null && (
                          <span className="text-theme-text-muted font-normal">
                            {' '}
                            — required for a rating of {threshold} or lower
                          </span>
                        )}
                      </label>
                      <textarea
                        id={`se-comment-${key}`}
                        rows={2}
                        maxLength={2000}
                        className={`form-input ${missingComment ? 'border-red-700' : ''}`}
                        aria-invalid={missingComment || undefined}
                        aria-describedby={missingComment ? `se-comment-${key}-error` : undefined}
                        value={answer?.comment ?? ''}
                        onChange={(e) => setAnswer(key, { comment: e.target.value })}
                      />
                      {missingComment && (
                        <p id={`se-comment-${key}-error`} className="mt-1 text-xs font-semibold text-red-700">
                          Add a comment explaining this rating.
                        </p>
                      )}
                    </div>
                  )}
                  {!needsComment && (answer?.comment ?? '') === '' && !openComments.has(key) && (
                    <button
                      type="button"
                      className="mt-1 text-sm font-medium text-red-800 hover:underline dark:text-red-400"
                      onClick={() => setOpenComments((prev) => new Set(prev).add(key))}
                    >
                      + Add comment
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {form.closing_comments_label && (
        <section className="card space-y-2 p-4" aria-labelledby="se-closing-heading">
          <h2 id="se-closing-heading" className="text-theme-text-primary font-semibold">
            <label htmlFor="se-closing">{form.closing_comments_label}</label>
          </h2>
          {form.closing_comments_hint && <p className="text-theme-text-muted text-xs">{form.closing_comments_hint}</p>}
          <textarea
            id="se-closing"
            rows={5}
            maxLength={5000}
            className="form-input"
            value={draft.closing_comments}
            onChange={(e) => onChange({ ...draft, closing_comments: e.target.value })}
          />
        </section>
      )}
    </div>
  );
};

export default ShiftEvaluationFields;
