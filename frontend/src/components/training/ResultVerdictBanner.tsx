/**
 * Result Verdict Banner
 *
 * The headline on a finished scorecard: the verdict, the reason for it, and
 * the steps that decided it.
 *
 * It exists because the verdict and the number are separate facts, and the old
 * headline showed only the second. A test failed on a critical step read
 * "Failed — Overall score: 86%", with nothing above the fold reconciling the
 * two; the explanation sat in an alert at the foot of the score breakdown,
 * below every section of the sheet. A candidate reading their own result — the
 * person least able to ask the examiner afterwards — had to scroll past the
 * whole scorecard to learn why they failed, and the two numbers in between
 * disagreed because each surface rounded for itself.
 *
 * Three things follow from that, and all three are the point of this component:
 *
 *  1. The reason is part of the headline, not a footnote.
 *  2. The critical steps that overrode the percentage are named immediately
 *     beneath it, not after the arithmetic they had nothing to do with.
 *  3. When no percentage decided anything — a pass/fail sheet with no point
 *     pool, or a template that sets no passing mark — it says so, rather than
 *     printing a figure the reader will assume was the threshold.
 *
 * Every figure comes from the server's `score_breakdown`, computed against the
 * template snapshot the test was scored under. Nothing here is recomputed:
 * a headline that can disagree with the working below it is what this replaces.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

import type { ScoreBreakdown, TestResult } from '../../types/skillsTesting';
import { formatScore } from '../../utils/skillScoreFormat';

/** The sentence under the verdict, naming whatever actually decided it.
 *
 *  Order matters: a critical failure overrides the percentage entirely, so it
 *  is reported first even on a scorecard that also missed the threshold —
 *  fixing the percentage would not change that outcome, and saying so would
 *  send the candidate to re-test the wrong thing.
 */
function verdictReason(breakdown: ScoreBreakdown | undefined, result: TestResult): string | null {
  if (!breakdown) return null;

  const {
    percentage,
    passing_percentage: passingPercentage,
    meets_threshold: meetsThreshold,
    require_all_critical: requireAllCritical,
    critical_failures: criticalFailures,
    method,
  } = breakdown;

  const criticalCount = requireAllCritical ? criticalFailures.length : 0;

  if (result === 'fail' && criticalCount > 0) {
    return criticalCount === 1
      ? 'A critical step was not met, which fails the test whatever the score.'
      : `${criticalCount} critical steps were not met, which fails the test whatever the score.`;
  }

  if (percentage == null || method === 'none') {
    // No number was involved in the decision, so naming one would be a lie of
    // omission — the sheet was judged entirely on its critical steps.
    return requireAllCritical
      ? 'Judged on its critical steps — this sheet carries no scored steps, so there is no percentage.'
      : 'This sheet carries no scored steps, so there is no percentage.';
  }

  if (passingPercentage == null) {
    return `Scored ${formatScore(percentage)}. This sheet sets no passing mark, so the score alone did not decide the outcome.`;
  }

  return meetsThreshold
    ? `Scored ${formatScore(percentage)}, at or above the ${formatScore(passingPercentage)} passing mark.`
    : `Scored ${formatScore(percentage)}, below the ${formatScore(passingPercentage)} passing mark.`;
}

export const ResultVerdictBanner: React.FC<{
  result: TestResult;
  breakdown?: ScoreBreakdown | undefined;
  /** Falls back to the breakdown's own percentage; passed separately because a
   *  redacted view can carry the score without the working behind it. */
  overallScore?: number | null | undefined;
  /** A voided result is shown struck through and in neutral colour — it no
   *  longer counts, and painting it green would say otherwise. */
  isVoided?: boolean;
}> = ({ result, breakdown, overallScore, isVoided = false }) => {
  const passed = result === 'pass';
  const reason = verdictReason(breakdown, result);
  const score = breakdown?.percentage ?? overallScore;

  const criticalFailures = breakdown?.require_all_critical ? (breakdown.critical_failures ?? []) : [];

  return (
    <div className="space-y-3">
      <div
        className={`flex items-start gap-3 rounded-xl p-4 ${
          isVoided
            ? 'bg-theme-surface border-theme-surface-border border'
            : passed
              ? 'border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
              : 'border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
        }`}
      >
        {passed ? (
          <CheckCircle2 className="mt-0.5 h-10 w-10 shrink-0 text-green-500" aria-hidden="true" />
        ) : (
          <XCircle className="mt-0.5 h-10 w-10 shrink-0 text-red-500" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-lg font-bold ${
              isVoided
                ? 'text-theme-text-muted line-through'
                : passed
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
            }`}
          >
            {passed ? 'Passed' : 'Failed'}
            {/* The figure rides in the headline only when it is a figure — a
                sheet with no point pool gets the sentence below instead of a
                blank where a percentage would be. */}
            {score != null && <span className="text-theme-text-secondary ml-2 font-mono">{formatScore(score)}</span>}
          </p>
          {reason && <p className="text-theme-text-secondary mt-0.5 text-sm">{reason}</p>}
        </div>
      </div>

      {criticalFailures.length > 0 && (
        <div className="alert-warning">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {criticalFailures.length === 1 ? 'Critical step not met' : 'Critical steps not met'}
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {criticalFailures.map((failure, index) => (
              <li key={`${failure.criterion_label ?? 'criterion'}-${index}`}>
                {failure.criterion_label || 'Unnamed step'}
                {failure.section_name && <span className="text-xs"> ({failure.section_name})</span>}
                {/* Named as left unmarked rather than failed: the scorer treats
                    the two identically, but the candidate did not necessarily
                    do anything wrong, and the officer validating needs to see
                    which it was. */}
                {failure.reason === 'not_scored' && <span className="text-xs italic"> — left unmarked</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ResultVerdictBanner;
