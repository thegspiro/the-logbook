/**
 * Score Breakdown Panel
 *
 * Shows a finished scorecard's own working: the point total behind the
 * headline percentage, which sections contributed to it, the threshold it was
 * judged against, and any critical step that decided the outcome on its own.
 *
 * It exists because the percentage is not computed from everything on the
 * sheet. Only point-carrying steps count, so a template whose knowledge
 * questions are written as Pass/Fail steps produces a percentage that ignores
 * them entirely — a candidate can miss half of them without the number moving.
 * That is a legitimate way to build a sheet, but it is indefensible for the
 * scorecard not to say so: a reader comparing "86%" against four visible
 * questions, two of them failed, has no way to reconcile the two.
 *
 * Every figure here comes from the backend (SkillTest.score_breakdown), which
 * computes it with the same function that scored the test, against the
 * template snapshot the test was taken under. Nothing on this panel is
 * recomputed client-side — working that can disagree with the number it claims
 * to explain is worse than no working at all.
 */

import React from 'react';
import { AlertTriangle, Calculator } from 'lucide-react';

import type { ScoreBreakdown } from '../../types/skillsTesting';

/** Trims float noise without hiding real fractions: 12 -> "12", 12.5 -> "12.5" */
function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

const ScoredSectionRow: React.FC<{ section: ScoreBreakdown['sections'][number] }> = ({ section }) => {
  const tallies: string[] = [];
  if (section.passed > 0) tallies.push(`${section.passed} passed`);
  if (section.failed > 0) tallies.push(`${section.failed} failed`);
  if (section.not_scored > 0) tallies.push(`${section.not_scored} not scored`);
  if (section.statements > 0) tallies.push(`${section.statements} statement${section.statements === 1 ? '' : 's'}`);

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-theme-text-primary truncate text-sm">{section.section_name || 'Untitled section'}</p>
        {tallies.length > 0 && <p className="text-theme-text-muted text-xs">{tallies.join(' · ')}</p>}
      </div>
      {section.counts_toward_score ? (
        <p className="text-theme-text-primary shrink-0 font-mono text-sm font-medium">
          {formatPoints(section.earned ?? 0)}/{formatPoints(section.available ?? 0)} pts
        </p>
      ) : (
        <p className="text-theme-text-muted shrink-0 text-xs italic">not scored</p>
      )}
    </div>
  );
};

export const ScoreBreakdownPanel: React.FC<{ breakdown: ScoreBreakdown }> = ({ breakdown }) => {
  const {
    method,
    earned,
    available,
    percentage,
    passing_percentage: passingPercentage,
    meets_threshold: meetsThreshold,
    require_all_critical: requireAllCritical,
    critical_failures: criticalFailures,
    score_pass_fail_criteria: scorePassFail,
    sections,
  } = breakdown;

  const uncountedSections = sections.filter((s) => !s.counts_toward_score);

  return (
    <div className="card">
      <p className="text-theme-text-muted mb-2 flex items-center gap-1.5 text-xs font-medium">
        <Calculator className="h-3 w-3" />
        How this score was calculated
      </p>

      {method === 'points' && (
        <p className="text-theme-text-primary text-sm">
          <span className="font-mono font-medium">
            {formatPoints(earned)} of {formatPoints(available)} points
          </span>{' '}
          earned{percentage != null && <> = {percentage}%</>}
        </p>
      )}
      {method === 'section_average' && (
        <p className="text-theme-text-primary text-sm">
          Averaged from per-section scores — this template has no steps carrying points.
        </p>
      )}
      {method === 'none' && (
        <p className="text-theme-text-primary text-sm">
          No percentage could be calculated — nothing on this template carries points.
        </p>
      )}

      <p className="text-theme-text-secondary mt-1 text-sm">
        {passingPercentage != null ? (
          <>
            Passing mark is {passingPercentage}% — {meetsThreshold ? 'met' : 'not met'}.
          </>
        ) : (
          <>This template sets no passing percentage, so the score alone cannot fail the test.</>
        )}
      </p>

      <div className="border-theme-surface-border divide-theme-surface-border mt-3 divide-y border-t pt-1">
        {sections.map((section, index) => (
          <ScoredSectionRow key={`${section.section_name ?? 'section'}-${index}`} section={section} />
        ))}
      </div>

      {/* The point that makes the whole panel worth showing: a section can sit
          on the scorecard, be marked up in detail, and count for nothing. */}
      {uncountedSections.length > 0 && (
        <p className="text-theme-text-muted mt-3 text-xs">
          {uncountedSections.length === 1 ? (
            <>
              <span className="font-medium">{uncountedSections[0]?.section_name || 'One section'}</span> holds no steps
              carrying points, so nothing in it changed the percentage.
            </>
          ) : (
            <>
              <span className="font-medium">{uncountedSections.length} sections</span> hold no steps carrying points, so
              nothing in them changed the percentage.
            </>
          )}
          {!scorePassFail && (
            <>
              {' '}
              Pass/Fail steps are not worth points on this template — a training officer can change that in its scoring
              settings.
            </>
          )}
        </p>
      )}

      {requireAllCritical && criticalFailures.length > 0 && (
        <div className="alert-warning mt-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {criticalFailures.length === 1 ? 'A critical step' : `${criticalFailures.length} critical steps`} failed
            this test regardless of the percentage
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {criticalFailures.map((failure, index) => (
              <li key={`${failure.criterion_label ?? 'criterion'}-${index}`}>
                {failure.criterion_label || 'Unnamed step'}
                {failure.section_name && <span className="text-xs"> ({failure.section_name})</span>}
                {failure.reason === 'not_scored' && <span className="text-xs italic"> — left unscored</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ScoreBreakdownPanel;
