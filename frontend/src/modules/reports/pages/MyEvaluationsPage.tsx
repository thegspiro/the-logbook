/**
 * A member's own evaluations, and their figures for the current review period
 * measured now — training, attendance, shifts and the rest, brought together
 * where the evaluation will read them.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '../../../components/ux/EmptyState';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { DeletionRecordList } from '../components/evaluations/DeletionRecordList';
import { FiguresPanel } from '../components/evaluations/FiguresPanel';
import { evaluationsService } from '../services/evaluationsApi';
import type { EvaluationDeletionRecord, EvaluationSummary, LiveData } from '../types/evaluations';

const MyEvaluationsPage: React.FC = () => {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[] | null>(null);
  const [live, setLive] = useState<LiveData | null>(null);
  const [removed, setRemoved] = useState<EvaluationDeletionRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([evaluationsService.mine(), evaluationsService.liveData(), evaluationsService.myRemoved()])
      .then(([mine, figures, deleted]) => {
        if (cancelled) return;
        setEvaluations(mine);
        setLive(figures);
        setRemoved(deleted);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getErrorMessage(err, 'Could not load your evaluations.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="page-header mb-6">
          <div className="page-header-title">
            <h1 className="text-theme-text-primary text-3xl font-bold">My evaluations</h1>
            <p className="text-theme-text-secondary mt-1">
              Your performance evaluations, and how your figures stand for the current review period.
            </p>
          </div>
        </div>

        {error && (
          <div className="alert-danger mb-6">
            <p className="text-theme-alert-danger-text text-sm">{error}</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="mine-heading">
            <h2 id="mine-heading" className="text-theme-text-primary mb-3 text-xl font-semibold">
              Evaluations
            </h2>
            {evaluations === null && !error ? (
              <p className="text-theme-text-secondary text-sm">Loading…</p>
            ) : evaluations && evaluations.length === 0 ? (
              <EmptyState title="No evaluations yet" description="Your evaluations will be listed here." />
            ) : (
              <ul className="space-y-3">
                {(evaluations ?? []).map((evaluation) => (
                  <li key={evaluation.id} className="card p-4">
                    <Link
                      to={`/reports/evaluations/${evaluation.id}`}
                      className="text-theme-text-primary font-semibold underline-offset-2 hover:underline"
                    >
                      {evaluation.period_name ?? evaluation.template_name}
                    </Link>
                    <p className="text-theme-text-secondary mt-1 text-sm">
                      {formatCalendarDate(evaluation.period_start)} – {formatCalendarDate(evaluation.period_end)}
                      {' · '}
                      {evaluation.status === 'finalized'
                        ? 'Complete'
                        : evaluation.current_step
                          ? `Waiting on: ${evaluation.current_step}`
                          : 'In progress'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {removed.length > 0 && (
              <section aria-labelledby="removed-heading" className="mt-6">
                <h2 id="removed-heading" className="text-theme-text-primary mb-1 text-xl font-semibold">
                  Deleted evaluations
                </h2>
                <p className="text-theme-text-secondary mb-3 text-sm">
                  Evaluations of yours that were deleted, by whom and why.
                </p>
                <DeletionRecordList records={removed} showMember={false} />
              </section>
            )}
          </section>

          {live && (
            <FiguresPanel
              title={live.period_name ? `Your figures — ${live.period_name}` : 'Your figures'}
              sources={live.sources}
              data={live.data}
              coverageStart={live.coverage_start}
              coverageEnd={live.coverage_end}
              excluded={live.excluded_ranges}
              footnote={
                live.note ?? 'Measured now, up to today. Your evaluation records the figures when it is drafted.'
              }
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default MyEvaluationsPage;
