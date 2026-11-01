/**
 * A submitted shift evaluation, read back on the form it was filled out on.
 *
 * Renders from the evaluation's own copy of the form, never the template as
 * it is today, so a reworded item still shows the question that was rated.
 * The average comes from the server, which computed it (Pitfall #29).
 */

import React from 'react';
import type { ShiftEvaluationDetail } from '../../types/training';
import { SHIFT_EVALUATION_STATISTIC_LABELS } from '../../utils/shiftEvaluations';

interface Props {
  evaluation: ShiftEvaluationDetail;
  /** Print layout: plain borders, no theme surfaces. */
  variant?: 'screen' | 'print';
}

const ratingTone = (rating: number | null, threshold: number | null, top: number) => {
  if (rating == null) return 'bg-theme-surface-secondary text-theme-text-secondary';
  if (threshold != null && rating <= threshold)
    return 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100';
  if (rating === top) return 'bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100';
  return 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100';
};

export const ShiftEvaluationView: React.FC<Props> = ({ evaluation, variant = 'screen' }) => {
  const form = evaluation.template;
  const labels = new Map(form.scale.map((level) => [level.value, level.label]));
  const top = form.scale.reduce((max, level) => Math.max(max, level.value), 0);
  const print = variant === 'print';
  const cell = print
    ? 'border border-black px-2 py-1 align-top'
    : 'border-theme-surface-border border-b px-3 py-2 align-top';
  const head = print
    ? 'border border-black px-2 py-1 text-left font-semibold'
    : 'text-theme-text-muted border-theme-surface-border border-b px-3 py-2 text-left text-xs font-semibold uppercase';

  return (
    <div className="space-y-4">
      {(form.header_fields.length > 0 || form.statistics.length > 0) && (
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {form.header_fields.map((field) => (
            <div key={field.key}>
              <dt className={print ? 'font-semibold' : 'text-theme-text-muted text-xs'}>{field.label}</dt>
              <dd className={print ? '' : 'text-theme-text-primary'}>
                {evaluation.header_values[field.key ?? ''] || '—'}
              </dd>
            </div>
          ))}
          {form.statistics.map((stat) => (
            <div key={stat}>
              <dt className={print ? 'font-semibold' : 'text-theme-text-muted text-xs'}>
                {SHIFT_EVALUATION_STATISTIC_LABELS[stat]}
              </dt>
              <dd className={print ? '' : 'text-theme-text-primary'}>{evaluation.statistics[stat] ?? '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className={print ? 'text-sm' : 'text-theme-text-secondary text-sm'}>
        {form.scale.map((level) => `${level.value} = ${level.label}`).join(', ')}
        {form.allow_not_applicable ? `, N/A = ${form.not_applicable_label}` : ''}
      </p>

      {form.sections.map((section) => (
        <section key={section.key}>
          <h3 className={print ? 'mb-1 font-bold' : 'text-theme-text-primary mb-2 font-semibold'}>{section.title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className={head}>
                    {section.column_heading}
                  </th>
                  <th scope="col" className={`${head} w-40`}>
                    Rating
                  </th>
                  <th scope="col" className={head}>
                    Comments
                  </th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item, index) => {
                  const answer = evaluation.responses[item.key ?? ''];
                  const rating = answer?.rating ?? null;
                  return (
                    <tr key={item.key}>
                      <td className={cell}>
                        {index + 1}. {item.label}
                      </td>
                      <td className={cell}>
                        {answer?.not_applicable ? (
                          'N/A'
                        ) : rating == null ? (
                          '—'
                        ) : print ? (
                          rating
                        ) : (
                          <span className="flex items-center gap-2">
                            <span
                              className={`inline-grid h-6 min-w-7 place-items-center rounded px-1 text-xs font-bold ${ratingTone(
                                rating,
                                form.comment_required_at_or_below,
                                top
                              )}`}
                            >
                              {rating}
                            </span>
                            <span className="text-theme-text-muted text-xs">{labels.get(rating)}</span>
                          </span>
                        )}
                      </td>
                      <td className={`${cell} whitespace-pre-wrap`}>{answer?.comment ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {form.closing_comments_label && (
        <section>
          <h3 className={print ? 'font-bold' : 'text-theme-text-primary font-semibold'}>
            {form.closing_comments_label}
          </h3>
          <p className={`whitespace-pre-wrap ${print ? '' : 'text-theme-text-secondary'}`}>
            {evaluation.closing_comments || '—'}
          </p>
        </section>
      )}
    </div>
  );
};

export default ShiftEvaluationView;
