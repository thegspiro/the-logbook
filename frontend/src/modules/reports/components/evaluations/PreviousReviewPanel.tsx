/**
 * The member's last finalized review on the same form, beside this one: the
 * grades that stood and the goals it set, so this year's review can say
 * whether they were met. The server sends it only to people who could open
 * that review themselves.
 */
import React from 'react';
import { Link } from 'react-router';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import type { PreviousReview } from '../../types/evaluations';

interface PreviousReviewPanelProps {
  review: PreviousReview;
}

export const PreviousReviewPanel: React.FC<PreviousReviewPanelProps> = ({ review }) => (
  <section aria-labelledby="previous-review-heading" className="card p-4 sm:p-6">
    <h2 id="previous-review-heading" className="text-theme-text-primary text-lg font-semibold">
      Last review
    </h2>
    <p className="text-theme-text-secondary mt-1 text-sm">
      {review.period_name ? `${review.period_name}, ` : ''}
      {formatCalendarDate(review.period_start)} – {formatCalendarDate(review.period_end)}
    </p>
    {review.overall && (
      <p className="text-theme-text-primary mt-3 text-sm">
        Overall: <span className="font-semibold">{review.overall}</span>
      </p>
    )}
    {review.sections.length > 0 && (
      <dl className="mt-2 space-y-1 text-sm">
        {review.sections.map((section) => (
          <div key={section.key} className="flex flex-wrap justify-between gap-x-3">
            <dt className="text-theme-text-secondary">{section.title}</dt>
            <dd className="text-theme-text-primary">{section.label}</dd>
          </div>
        ))}
      </dl>
    )}
    {review.goals.length > 0 && (
      <div className="mt-4">
        <h3 className="text-theme-text-primary text-sm font-semibold">Goals set then</h3>
        <ul className="mt-1 space-y-2 text-sm">
          {review.goals.map((goal) => (
            <li key={goal.key}>
              <span className="text-theme-text-secondary">{goal.label}</span>
              <p className="text-theme-text-primary whitespace-pre-line">{goal.text}</p>
            </li>
          ))}
        </ul>
      </div>
    )}
    <Link
      to={`/reports/evaluations/${review.evaluation_id}`}
      className="text-theme-text-primary touch:min-h-11 mt-4 inline-flex items-center text-sm font-medium underline underline-offset-2"
    >
      Open the last review
    </Link>
  </section>
);
