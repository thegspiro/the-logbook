/**
 * The figures an evaluation shows: each data source's measured value over the
 * member's coverage, with what was left out (leaves, gaps in membership).
 */
import React from 'react';
import { formatCalendarDate } from '../../../../utils/dateFormatting';
import type { DataEntry, EvaluationDataSource, ExcludedRange } from '../../types/evaluations';
import { formatFigure } from '../../utils/evaluationRecord';

interface FiguresPanelProps {
  title: string;
  sources: EvaluationDataSource[];
  data: Record<string, DataEntry>;
  coverageStart: string | null;
  coverageEnd: string | null;
  excluded: ExcludedRange[];
  footnote?: string | undefined;
}

const REASON_LABELS: Record<ExcludedRange['reason'], string> = {
  leave: 'Leave of absence',
  separation: 'Not a member',
};

export const FiguresPanel: React.FC<FiguresPanelProps> = ({
  title,
  sources,
  data,
  coverageStart,
  coverageEnd,
  excluded,
  footnote,
}) => (
  <section aria-labelledby="figures-heading" className="card p-4 sm:p-6">
    <h2 id="figures-heading" className="text-theme-text-primary text-lg font-semibold">
      {title}
    </h2>
    {coverageStart && coverageEnd && (
      <p className="text-theme-text-secondary mt-1 text-sm">
        Measured {formatCalendarDate(coverageStart)} – {formatCalendarDate(coverageEnd)}
      </p>
    )}
    {excluded.length > 0 && (
      <ul className="text-theme-text-secondary mt-1 text-sm">
        {excluded.map((range) => (
          <li key={`${range.start}-${range.reason}`}>
            Left out: {REASON_LABELS[range.reason]}, {formatCalendarDate(range.start)} – {formatCalendarDate(range.end)}
          </li>
        ))}
      </ul>
    )}
    {sources.length === 0 ? (
      <p className="text-theme-text-secondary mt-3 text-sm">This form shows no figures.</p>
    ) : (
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {sources.map((source) => {
          const entry = data[source.key];
          return (
            <div key={source.key} className="card-secondary p-3">
              <dt className="text-theme-text-secondary text-sm">{source.label}</dt>
              <dd
                className={`mt-1 ${entry?.available ? 'text-theme-text-primary text-lg font-semibold' : 'text-theme-text-secondary text-sm'}`}
              >
                {formatFigure(entry, source.unit)}
              </dd>
            </div>
          );
        })}
      </dl>
    )}
    {footnote && <p className="text-theme-text-muted mt-3 text-xs">{footnote}</p>}
  </section>
);
